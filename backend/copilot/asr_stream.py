"""阿里云 NLS 实时语音识别封装 — 线程模型桥接到 asyncio。"""
import json
import asyncio
import logging
from typing import Callable, Awaitable

from backend.config import settings

logger = logging.getLogger("uvicorn")

# NLS Token 缓存
_nls_token_cache: dict = {"token": "", "expire_time": 0}


def get_nls_token() -> str:
    """获取 NLS Token（带缓存），通过阿里云 AccessKey 动态获取。"""
    import time
    now = int(time.time())
    if _nls_token_cache["token"] and _nls_token_cache["expire_time"] > now + 60:
        return _nls_token_cache["token"]

    if not settings.nls_access_key_id or not settings.nls_access_key_secret:
        raise RuntimeError(
            "NLS_ACCESS_KEY_ID and NLS_ACCESS_KEY_SECRET required for real-time ASR. "
            "Configure them in .env"
        )

    try:
        from aliyunsdkcore.client import AcsClient
        from aliyunsdkcore.request import CommonRequest

        client = AcsClient(
            settings.nls_access_key_id,
            settings.nls_access_key_secret,
            "cn-shanghai",
        )
        request = CommonRequest()
        request.set_method("POST")
        request.set_domain("nls-meta.cn-shanghai.aliyuncs.com")
        request.set_version("2019-02-28")
        request.set_action_name("CreateToken")

        resp = json.loads(client.do_action_with_exception(request))
        token = resp["Token"]["Id"]
        expire_time = resp["Token"]["ExpireTime"]
        _nls_token_cache["token"] = token
        _nls_token_cache["expire_time"] = expire_time
        logger.info(f"NLS Token refreshed, expires at {expire_time}")
        return token
    except ImportError:
        raise RuntimeError(
            "aliyun-python-sdk-core is required for NLS Token. "
            "Install: pip install aliyun-python-sdk-core"
        )
    except Exception as e:
        raise RuntimeError(f"Failed to get NLS Token: {e}")


class CopilotASR:
    """封装 NLS 实时语音识别，桥接到 asyncio 事件循环。"""

    def __init__(self, loop: asyncio.AbstractEventLoop):
        self._loop = loop
        self._transcriber = None
        self._started = False

        # 外部注册的 async 回调
        self.on_interim: Callable[[str], Awaitable] | None = None
        self.on_sentence_end: Callable[[str], Awaitable] | None = None
        self.on_error: Callable[[str], Awaitable] | None = None

    def start(self):
        """启动 NLS 实时识别（同步调用）。"""
        try:
            import nls
        except ImportError:
            raise RuntimeError(
                "NLS Python SDK not installed. "
                "Install: git clone https://github.com/aliyun/alibabacloud-nls-python-sdk.git "
                "&& cd alibabacloud-nls-python-sdk && pip install -r requirements.txt && pip install ."
            )

        if not settings.nls_appkey:
            raise RuntimeError("NLS_APPKEY required. Configure in .env")

        token = get_nls_token()

        self._transcriber = nls.NlsSpeechTranscriber(
            url=settings.nls_url,
            token=token,
            appkey=settings.nls_appkey,
            on_sentence_begin=self._on_sentence_begin,
            on_sentence_end=self._on_sentence_end,
            on_result_changed=self._on_result_changed,
            on_completed=self._on_completed,
            on_error=self._on_error,
            on_close=self._on_close,
        )
        try:
            self._transcriber.start(
                aformat="pcm",
                sample_rate=16000,
                enable_intermediate_result=True,
                enable_punctuation_prediction=True,
                enable_inverse_text_normalization=True,
            )
            self._started = True
            logger.info("NLS ASR started")
            return True
        except Exception as e:
            logger.error(f"NLS ASR failed to start: {e}")
            return False

    def send_audio(self, pcm_data: bytes) -> bool:
        if self._transcriber and self._started:
            return self._transcriber.send_audio(pcm_data)
        return False

    def stop(self):
        if self._transcriber and self._started:
            self._transcriber.stop()
            self._started = False
            logger.info("NLS ASR stopped")

    def shutdown(self):
        if self._transcriber:
            self._transcriber.shutdown()
            self._started = False

    # ---- NLS 回调（子线程） → asyncio 桥接 ----

    def _on_result_changed(self, message, *args):
        text = self._extract_text(message)
        if text and self.on_interim:
            self._loop.call_soon_threadsafe(
                asyncio.ensure_future, self.on_interim(text)
            )

    def _on_sentence_end(self, message, *args):
        text = self._extract_text(message)
        if text and self.on_sentence_end:
            self._loop.call_soon_threadsafe(
                asyncio.ensure_future, self.on_sentence_end(text)
            )

    def _on_sentence_begin(self, message, *args):
        logger.debug(f"ASR sentence begin: {message}")

    def _on_completed(self, message, *args):
        logger.info(f"ASR completed")

    def _on_error(self, message, *args):
        logger.error(f"ASR error: {message}")
        if self.on_error:
            self._loop.call_soon_threadsafe(
                asyncio.ensure_future, self.on_error(str(message))
            )

    def _on_close(self, *args):
        logger.info("ASR connection closed")
        self._started = False

    @staticmethod
    def _extract_text(message: str) -> str:
        try:
            data = json.loads(message)
            return data.get("payload", {}).get("result", "")
        except (json.JSONDecodeError, AttributeError, TypeError):
            return ""
