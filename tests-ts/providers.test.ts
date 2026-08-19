import { describe, expect, test } from 'bun:test'
import { DEFAULT_EMBEDDING_MODEL } from '@techspar/core'
import { ApiEmbeddingClient, PcmSpeechSegmenter, normalizeEmbeddingApiBase } from '@techspar/providers'

describe('embedding provider compatibility', () => {
  test('defaults local inference to a Transformers.js ONNX checkpoint', () => {
    expect(DEFAULT_EMBEDDING_MODEL).toBe('Xenova/bge-m3')
  })

  test.each([
    ['https://example.test/v1', 'https://example.test/v1'],
    ['https://example.test/v1/', 'https://example.test/v1'],
    ['https://example.test/v1/embeddings', 'https://example.test/v1'],
    ['https://example.test/v1/EMBEDDINGS/', 'https://example.test/v1'],
  ])('normalizes %s', (input, expected) => expect(normalizeEmbeddingApiBase(input)).toBe(expected))

  test('falls back after a 400 and remembers scalar-only capability', async () => {
    const calls: Array<string | string[]> = []
    const client = {
      embeddings: {
        async create(input: { input: string | string[] }) {
          calls.push(input.input)
          if (Array.isArray(input.input)) throw Object.assign(new Error('bad request'), { status: 400 })
          return { data: [{ index: 0, embedding: [input.input.length] }] }
        },
      },
    }
    const embedding = new ApiEmbeddingClient({ apiBase: 'https://example.test/v1', apiKey: 'key', model: 'model', batchSize: 10 }, client)
    expect(await embedding.embed(['a', 'bb', 'ccc'])).toEqual([[1], [2], [3]])
    expect(await embedding.embed(['dddd', 'eeeee'])).toEqual([[4], [5]])
    expect(calls).toEqual([['a', 'bb', 'ccc'], 'a', 'bb', 'ccc', 'dddd', 'eeeee'])
  })

  test('does not hide non-400 provider failures', async () => {
    const calls: Array<string | string[]> = []
    const client = {
      embeddings: {
        async create(input: { input: string | string[] }): Promise<{ data: Array<{ index: number; embedding: number[] }> }> {
          calls.push(input.input)
          throw Object.assign(new Error('unavailable'), { status: 503 })
        },
      },
    }
    const embedding = new ApiEmbeddingClient({ apiBase: '', apiKey: 'key', model: 'model' }, client)
    await expect(embedding.embed(['a', 'b'])).rejects.toThrow('unavailable')
    expect(calls).toEqual([['a', 'b']])
  })
})

describe('realtime PCM segmentation', () => {
  test('buffers split 16 kHz frames and emits sustained speech after silence', () => {
    const frameBytes = 960
    const pcm = new Uint8Array(frameBytes * 63)
    const view = new DataView(pcm.buffer)
    for (let frame = 0; frame < 50; frame += 1) {
      for (let offset = frame * frameBytes; offset < (frame + 1) * frameBytes; offset += 2) view.setInt16(offset, 1200, true)
    }
    const segmenter = new PcmSpeechSegmenter()
    expect(segmenter.feed(pcm.slice(0, 123))).toHaveLength(0)
    const segments = segmenter.feed(pcm.slice(123))
    expect(segments).toHaveLength(1)
    expect(segments[0]?.length).toBe(frameBytes * 50)
  })
})
