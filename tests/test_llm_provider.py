import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend import llm_provider


class _ProviderError(RuntimeError):
    def __init__(self, status_code: int):
        self.status_code = status_code
        super().__init__(f"provider returned {status_code}")


class _FakeEmbeddings:
    def __init__(self, create):
        self.create = create


class _FakeOpenAI:
    def __init__(self, create):
        self.embeddings = _FakeEmbeddings(create)


def _response(*vectors):
    return SimpleNamespace(
        data=[
            SimpleNamespace(index=index, embedding=vector)
            for index, vector in enumerate(vectors)
        ]
    )


class APIEmbeddingCompatibilityTests(unittest.TestCase):
    @staticmethod
    def _embedding(create, *, batch_size=10):
        with patch("openai.OpenAI", return_value=_FakeOpenAI(create)):
            return llm_provider._APIEmbedding(
                model="test-embedding",
                api_key="test-key",
                api_base="https://example.test/v1",
                batch_size=batch_size,
            )

    def test_batch_capable_provider_keeps_using_array_input(self):
        calls = []

        def create(*, model, input):
            calls.append((model, input))
            return _response(*[[float(len(text))] for text in input])

        embedding = self._embedding(create, batch_size=2)

        result = embedding.get_text_embedding_batch(["a", "bb", "ccc"])

        self.assertEqual(result, [[1.0], [2.0], [3.0]])
        self.assertEqual(
            calls,
            [
                ("test-embedding", ["a", "bb"]),
                ("test-embedding", ["ccc"]),
            ],
        )

    def test_bad_array_request_falls_back_to_scalar_and_remembers_capability(self):
        calls = []

        def create(*, model, input):
            calls.append(input)
            if isinstance(input, list):
                raise _ProviderError(400)
            return _response([float(len(input))])

        embedding = self._embedding(create)

        first = embedding.get_text_embedding_batch(["a", "bb", "ccc"])
        second = embedding.get_text_embedding_batch(["dddd", "eeeee"])

        self.assertEqual(first, [[1.0], [2.0], [3.0]])
        self.assertEqual(second, [[4.0], [5.0]])
        self.assertEqual(calls, [["a", "bb", "ccc"], "a", "bb", "ccc", "dddd", "eeeee"])

    def test_non_bad_request_error_does_not_retry_or_hide_failure(self):
        calls = []

        def create(*, model, input):
            calls.append(input)
            raise _ProviderError(503)

        embedding = self._embedding(create)

        with self.assertRaisesRegex(_ProviderError, "503"):
            embedding.get_text_embedding_batch(["a", "b"])

        self.assertEqual(calls, [["a", "b"]])

    def test_single_text_call_uses_scalar_input(self):
        calls = []

        def create(*, model, input):
            calls.append(input)
            return _response([1.0, 2.0])

        embedding = self._embedding(create)

        self.assertEqual(embedding.get_text_embedding("ping"), [1.0, 2.0])
        self.assertEqual(calls, ["ping"])


class EmbeddingProbeCompatibilityTests(unittest.TestCase):
    def test_api_probe_uses_scalar_input(self):
        calls = []

        def create(*, model, input):
            calls.append((model, input))
            return _response([1.0])

        config = {
            "backend": "api",
            "api_base": "https://example.test/v1",
            "api_key": "test-key",
            "api_model": "test-embedding",
            "local_model": "",
            "local_path": "",
            "api_batch_size": 10,
        }
        with patch("openai.OpenAI", return_value=_FakeOpenAI(create)):
            llm_provider.probe_embedding(config)

        self.assertEqual(calls, [("test-embedding", "ping")])


if __name__ == "__main__":
    unittest.main()
