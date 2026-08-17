import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import llm_provider, usage
from backend.config import settings
from backend.models import EmbeddingSettings, LLMSettings


def _llm(api_key="", model="", api_base="", temperature=0.7):
    return LLMSettings(api_base=api_base, api_key=api_key, model=model, temperature=temperature)


def _embedding(**kwargs):
    return EmbeddingSettings(**kwargs)


class _PlatformSettings:
    """平台兜底配置的临时开关,退出时还原。"""

    FIELDS = (
        "platform_llm_api_base", "platform_llm_api_key", "platform_llm_model",
        "platform_embedding_api_base", "platform_embedding_api_key",
        "platform_embedding_model", "platform_daily_call_limit",
    )

    def __init__(self, **values):
        self.values = values

    def __enter__(self):
        self.saved = {f: getattr(settings, f) for f in self.FIELDS}
        for f in self.FIELDS:
            setattr(settings, f, self.values.get(f, "" if f != "platform_daily_call_limit" else 0))
        return self

    def __exit__(self, *exc):
        for f, v in self.saved.items():
            setattr(settings, f, v)


PLATFORM_LLM = {
    "platform_llm_api_key": "platform-key",
    "platform_llm_model": "platform-model",
    "platform_llm_api_base": "https://platform.test/v1",
}


class LLMFallbackTests(unittest.TestCase):
    def test_unconfigured_user_without_platform_stays_unconfigured(self):
        with _PlatformSettings(), patch.object(
            llm_provider, "load_user_provider", return_value=(None, None)
        ):
            c = llm_provider.resolve_llm_config("u1")
        self.assertEqual(c["api_key"], "")
        self.assertEqual(c["source"], usage.USER)
        with self.assertRaises(llm_provider.ProviderNotConfigured):
            llm_provider._require_llm(c)

    def test_unconfigured_user_falls_back_to_platform(self):
        with _PlatformSettings(**PLATFORM_LLM), patch.object(
            llm_provider, "load_user_provider", return_value=(None, None)
        ):
            c = llm_provider.resolve_llm_config("u1")
        self.assertEqual(c["api_key"], "platform-key")
        self.assertEqual(c["model"], "platform-model")
        self.assertEqual(c["source"], usage.PLATFORM)

    def test_own_key_wins_over_platform(self):
        with _PlatformSettings(**PLATFORM_LLM), patch.object(
            llm_provider, "load_user_provider",
            return_value=(_llm(api_key="mine", model="my-model"), None),
        ):
            c = llm_provider.resolve_llm_config("u1")
        self.assertEqual(c["api_key"], "mine")
        self.assertEqual(c["source"], usage.USER)

    def test_partial_user_config_falls_back(self):
        """填了 key 却没选模型的半成品配置,以前会直接报未配置;现在应该走平台。"""
        with _PlatformSettings(**PLATFORM_LLM), patch.object(
            llm_provider, "load_user_provider",
            return_value=(_llm(api_key="mine", model=""), None),
        ):
            c = llm_provider.resolve_llm_config("u1")
        self.assertEqual(c["source"], usage.PLATFORM)


class EmbeddingFallbackTests(unittest.TestCase):
    PLATFORM = {
        "platform_embedding_api_key": "pe-key",
        "platform_embedding_model": "pe-model",
        "platform_embedding_api_base": "https://platform.test/v1",
    }

    def test_falls_back_to_platform_api_mode(self):
        with _PlatformSettings(**self.PLATFORM), patch.object(
            llm_provider, "load_user_provider", return_value=(None, None)
        ):
            c = llm_provider.resolve_embedding_config("u1")
        self.assertEqual(c["backend"], "api")
        self.assertEqual(c["api_model"], "pe-model")
        self.assertEqual(c["source"], usage.PLATFORM)

    def test_explicit_local_backend_is_not_hijacked(self):
        """选了 local 又用内置默认模型时 local_model/local_path 都为空。这类用户
        必须留在本地,否则向量签名一变就是一次全量索引重建。"""
        with _PlatformSettings(**self.PLATFORM), patch.object(
            llm_provider, "load_user_provider",
            return_value=(None, _embedding(backend="local")),
        ):
            c = llm_provider.resolve_embedding_config("u1")
        self.assertEqual(c["backend"], "local")
        self.assertEqual(c["source"], usage.USER)

    def test_own_api_key_wins(self):
        with _PlatformSettings(**self.PLATFORM), patch.object(
            llm_provider, "load_user_provider",
            return_value=(None, _embedding(backend="api", api_key="mine", api_model="m")),
        ):
            c = llm_provider.resolve_embedding_config("u1")
        self.assertEqual(c["api_key"], "mine")
        self.assertEqual(c["source"], usage.USER)


class QuotaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.saved_db = settings.db_path
        settings.db_path = Path(self.tmp.name) / "test.db"
        self.addCleanup(lambda: setattr(settings, "db_path", self.saved_db))
        usage.init_usage_table()
        self.addCleanup(usage.set_quota_policy, usage._default_policy)

    def test_own_key_calls_are_never_blocked(self):
        with _PlatformSettings(platform_daily_call_limit=1):
            for _ in range(5):
                usage.check_quota("u1", usage.USER)
                usage.record_call("u1", usage.USER, "m")
        self.assertEqual(usage.platform_calls_today("u1"), 0)

    def test_platform_calls_blocked_at_limit(self):
        with _PlatformSettings(platform_daily_call_limit=2):
            usage.check_quota("u1", usage.PLATFORM)
            usage.record_call("u1", usage.PLATFORM, "m")
            usage.check_quota("u1", usage.PLATFORM)
            usage.record_call("u1", usage.PLATFORM, "m")
            with self.assertRaises(usage.QuotaExceeded):
                usage.check_quota("u1", usage.PLATFORM)

    def test_limit_is_per_user(self):
        with _PlatformSettings(platform_daily_call_limit=1):
            usage.record_call("u1", usage.PLATFORM, "m")
            with self.assertRaises(usage.QuotaExceeded):
                usage.check_quota("u1", usage.PLATFORM)
            usage.check_quota("u2", usage.PLATFORM)  # 不受 u1 影响

    def test_zero_limit_means_unlimited(self):
        with _PlatformSettings(platform_daily_call_limit=0):
            for _ in range(20):
                usage.record_call("u1", usage.PLATFORM, "m")
            usage.check_quota("u1", usage.PLATFORM)

    def test_policy_is_replaceable(self):
        """商业版靠这个钩子挂订阅判定,不改开源代码。"""
        def subscription_policy(user_id):
            if user_id != "paid":
                raise usage.QuotaExceeded("请先订阅")

        usage.set_quota_policy(subscription_policy)
        usage.check_quota("paid", usage.PLATFORM)
        with self.assertRaises(usage.QuotaExceeded):
            usage.check_quota("free", usage.PLATFORM)

    def test_recording_failure_does_not_break_the_request(self):
        settings.db_path = Path(self.tmp.name) / "nonexistent" / "x" / "test.db"
        with patch.object(usage, "_get_conn", side_effect=sqlite3.OperationalError("boom")):
            usage.record_call("u1", usage.PLATFORM, "m")  # 不应抛


class ChatLLMMeteringTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.saved_db = settings.db_path
        settings.db_path = Path(self.tmp.name) / "test.db"
        self.addCleanup(lambda: setattr(settings, "db_path", self.saved_db))
        usage.init_usage_table()

    def _fake_client(self, prompt_tokens=11, completion_tokens=7):
        from types import SimpleNamespace

        def create(**_kwargs):
            return SimpleNamespace(
                choices=[SimpleNamespace(message=SimpleNamespace(content="hi"))],
                usage=SimpleNamespace(
                    prompt_tokens=prompt_tokens, completion_tokens=completion_tokens
                ),
            )

        return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))

    def test_invoke_records_tokens(self):
        llm = llm_provider.ChatLLM(
            "m", "k", "", 0.7, user_id="u1", source=usage.PLATFORM
        )
        with patch.object(llm_provider, "OpenAI", return_value=self._fake_client()):
            self.assertEqual(llm.invoke([{"role": "user", "content": "x"}]), "hi")

        conn = sqlite3.connect(str(settings.db_path))
        row = conn.execute(
            "SELECT source, model, prompt_tokens, completion_tokens FROM llm_usage"
        ).fetchone()
        conn.close()
        self.assertEqual(row, (usage.PLATFORM, "m", 11, 7))

    def test_invoke_blocked_when_over_quota(self):
        with _PlatformSettings(platform_daily_call_limit=1):
            usage.record_call("u1", usage.PLATFORM, "m")
            llm = llm_provider.ChatLLM(
                "m", "k", "", 0.7, user_id="u1", source=usage.PLATFORM
            )
            with patch.object(llm_provider, "OpenAI", return_value=self._fake_client()) as client:
                with self.assertRaises(usage.QuotaExceeded):
                    llm.invoke([{"role": "user", "content": "x"}])
                client.assert_not_called()  # 拦在发请求之前,不能先烧了 token 再说


if __name__ == "__main__":
    unittest.main()
