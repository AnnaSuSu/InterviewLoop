import OpenAI from 'openai'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import {
  DEFAULT_EMBEDDING_MODEL,
  embeddingModeOf,
  normalizeEmbeddingApiBase,
  type ChatDriver,
  type ChatDriverFactory,
  type ChatMessage,
  type EmbeddingDriver,
  type EmbeddingDriverFactory,
  type ResolvedEmbeddingConfig,
  type ResolvedLlmConfig,
  type ShortAsrDriver,
  type LongAsrDriver,
  type RealtimeAsrFactory,
  type RealtimeAsrSession,
  type WebSearchDriver,
  type VoiceprintCredentials,
  type VoiceprintDriver,
  type VoiceprintDriverFactory,
  type VoiceRoleDetector,
} from '@techspar/core'

export { normalizeEmbeddingApiBase } from '@techspar/core'

export class OpenAiChatDriverFactory implements ChatDriverFactory {
  create(config: ResolvedLlmConfig): ChatDriver {
    const client = new OpenAI({ apiKey: config.api_key, baseURL: config.api_base || undefined })
    return {
      async complete(messages: readonly ChatMessage[], signal: AbortSignal, options?: { maxTokens?: number; temperature?: number }) {
        const response = await client.chat.completions.create(
          {
            model: config.model,
            messages: [...messages],
            temperature: options?.temperature ?? config.temperature,
            ...(options?.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
          },
          { signal },
        )
        return {
          text: response.choices[0]?.message.content || '',
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
        }
      },
      async *stream(messages: readonly ChatMessage[], signal: AbortSignal, options?: { temperature?: number }) {
        const response = await client.chat.completions.create(
          { model: config.model, messages: [...messages], temperature: options?.temperature ?? config.temperature, stream: true },
          { signal },
        )
        for await (const chunk of response) {
          const token = chunk.choices[0]?.delta.content
          if (token) yield token
        }
      },
    }
  }
}

export type EmbeddingClientConfig = {
  apiBase: string
  apiKey: string
  model: string
  batchSize?: number
}

type EmbeddingApi = {
  embeddings: {
    create(
      input: { model: string; input: string | string[] },
      options?: { signal?: AbortSignal },
    ): Promise<{ data: Array<{ index: number; embedding: number[] }> }>
  }
}

export class ApiEmbeddingClient {
  private readonly client: EmbeddingApi
  private scalarMode = false

  constructor(private readonly config: EmbeddingClientConfig, client?: EmbeddingApi) {
    this.client = client || new OpenAI({ apiKey: config.apiKey, baseURL: normalizeEmbeddingApiBase(config.apiBase) }) as unknown as EmbeddingApi
  }

  async embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    if (texts.length === 0) return []
    const output: number[][] = []
    const batchSize = Math.max(1, this.config.batchSize || 10)
    for (let index = 0; index < texts.length; index += batchSize) {
      const batch = texts.slice(index, index + batchSize)
      if (this.scalarMode) {
        for (const text of batch) output.push(await this.embedOne(text, signal))
        continue
      }
      try {
        const response = await this.client.embeddings.create({ model: this.config.model, input: [...batch] }, { signal })
        const ordered = [...response.data].sort((a, b) => a.index - b.index).map((item) => item.embedding)
        if (ordered.length !== batch.length) throw new Error(`Embedding vector count mismatch: expected ${batch.length}, got ${ordered.length}`)
        output.push(...ordered)
      } catch (error) {
        const status = (error as { status?: number; status_code?: number }).status ?? (error as { status_code?: number }).status_code
        if (status !== 400 && !(error instanceof OpenAI.BadRequestError)) throw error
        this.scalarMode = true
        for (const text of batch) output.push(await this.embedOne(text, signal))
      }
    }
    return output
  }

  private async embedOne(text: string, signal?: AbortSignal): Promise<number[]> {
    const response = await this.client.embeddings.create({ model: this.config.model, input: text }, { signal })
    if (response.data.length !== 1) throw new Error(`Embedding vector count mismatch: expected 1, got ${response.data.length}`)
    return response.data[0]!.embedding
  }
}

export class OpenAiEmbeddingDriverFactory implements EmbeddingDriverFactory {
  async create(config: ResolvedEmbeddingConfig): Promise<EmbeddingDriver> {
    if (embeddingModeOf(config) === 'api') {
      const client = new ApiEmbeddingClient({
        apiBase: config.api_base,
        apiKey: config.api_key,
        model: config.api_model || DEFAULT_EMBEDDING_MODEL,
        batchSize: config.api_batch_size,
      })
      return {
        async embed(texts, signal) {
          return (await client.embed(texts, signal)).map((vector) => Float32Array.from(vector))
        },
      }
    }

    const { pipeline } = await import('@huggingface/transformers')
    const model = config.local_path || config.local_model || DEFAULT_EMBEDDING_MODEL
    const extractor = await pipeline('feature-extraction', model, { dtype: 'fp32' })
    return {
      async embed(texts, signal) {
        if (signal.aborted) throw signal.reason
        const result = await extractor([...texts], { pooling: 'mean', normalize: true })
        if (signal.aborted) throw signal.reason
        const vectors = result.tolist() as number[][]
        return vectors.map((vector) => Float32Array.from(vector))
      },
    }
  }
}

const audioMime: Record<string, string> = {
  '.webm': 'audio/webm',
  '.mp3': 'audio/mp3',
  '.wav': 'audio/wav',
  '.m4a': 'audio/m4a',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
}

export class DashScopeShortAsrDriver implements ShortAsrDriver {
  async transcribe(input: { apiKey: string; bytes: Uint8Array; suffix: string; signal: AbortSignal }): Promise<string> {
    const mime = audioMime[input.suffix.toLowerCase()] || 'audio/webm'
    const data = `data:${mime};base64,${Buffer.from(input.bytes).toString('base64')}`
    const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3-asr-flash',
        messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data } }] }],
        stream: false,
      }),
      signal: input.signal,
    })
    if (!response.ok) throw new Error(`DashScope sync ASR failed [${response.status}]: ${await response.text()}`)
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
    const text = body.choices?.[0]?.message?.content
    if (typeof text !== 'string') throw new Error(`DashScope response missing transcript; body=${JSON.stringify(body)}`)
    return text
  }
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const timer = setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
  })
}

export class DashScopeLongAsrDriver implements LongAsrDriver {
  async transcribe(input: Parameters<LongAsrDriver['transcribe']>[0]): Promise<string> {
    const endpoint = input.services.oss_endpoint.replace(/^https?:\/\//i, '').replace(/\/$/, '')
    const objectName = `audio/${randomUUID().replaceAll('-', '')}${input.suffix}`
    const bucket = input.services.oss_bucket
    const resource = `/${bucket}/${objectName}`
    const host = endpoint.startsWith(`${bucket}.`) ? endpoint : `${bucket}.${endpoint}`
    const objectUrl = `https://${host}/${objectName.split('/').map(encodeURIComponent).join('/')}`
    const sign = (value: string) => createHmac('sha1', input.services.oss_access_key_secret).update(value).digest('base64')
    const date = new Date().toUTCString()
    const uploadSignature = sign(`PUT\n\napplication/octet-stream\n${date}\n${resource}`)
    const uploaded = await fetch(objectUrl, { method: 'PUT', headers: { Authorization: `OSS ${input.services.oss_access_key_id}:${uploadSignature}`, Date: date, 'Content-Type': 'application/octet-stream' }, body: input.bytes as unknown as BodyInit, signal: input.signal })
    if (!uploaded.ok) throw new Error(`OSS upload failed [${uploaded.status}]: ${await uploaded.text()}`)
    try {
      const expires = Math.floor(Date.now() / 1000) + 3600
      const fileUrl = `${objectUrl}?OSSAccessKeyId=${encodeURIComponent(input.services.oss_access_key_id)}&Expires=${expires}&Signature=${encodeURIComponent(sign(`GET\n\n\n${expires}\n${resource}`))}`
      const submitted = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription', {
        method: 'POST',
        headers: { Authorization: `Bearer ${input.services.dashscope_api_key}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
        body: JSON.stringify({ model: 'qwen3-asr-flash-filetrans', input: { file_url: fileUrl }, parameters: { channel_id: [0] } }),
        signal: input.signal,
      })
      if (!submitted.ok) throw new Error(`Transcription submit failed [${submitted.status}]: ${await submitted.text()}`)
      const body = await submitted.json() as { output?: { task_id?: string } }
      const taskId = body.output?.task_id
      if (!taskId) throw new Error(`Transcription response missing task id: ${JSON.stringify(body)}`)

      for (let attempt = 0; attempt < 300; attempt += 1) {
        await wait(3000, input.signal)
        const response = await fetch(`https://dashscope.aliyuncs.com/api/v1/tasks/${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${input.services.dashscope_api_key}` }, signal: input.signal })
        if (!response.ok) throw new Error(`Transcription query failed [${response.status}]: ${await response.text()}`)
        const queried = await response.json() as { output?: { task_status?: string; message?: string; result?: { transcription_url?: string }; results?: Array<{ transcription_url?: string }> } }
        const output = queried.output || {}
        const status = String(output.task_status || '').toUpperCase()
        if (status === 'FAILED' || status === 'UNKNOWN') throw new Error(`Transcription ${status}: ${output.message || ''}`)
        if (status !== 'SUCCEEDED') continue
        const url = output.result?.transcription_url || output.results?.find((item) => item.transcription_url)?.transcription_url
        if (!url) return ''
        const result = await fetch(url, { signal: input.signal })
        if (!result.ok) throw new Error(`Transcription result failed [${result.status}]: ${await result.text()}`)
        const data = await result.json() as { transcripts?: Array<{ text?: string }> }
        return (data.transcripts || []).map((item) => item.text || '').filter(Boolean).join('\n')
      }
      throw new Error('Transcription timed out')
    } finally {
      try {
        const cleanupDate = new Date().toUTCString()
        const cleanupSignature = sign(`DELETE\n\n\n${cleanupDate}\n${resource}`)
        await fetch(objectUrl, { method: 'DELETE', headers: { Authorization: `OSS ${input.services.oss_access_key_id}:${cleanupSignature}`, Date: cleanupDate } })
      } catch { /* audio object cleanup is best effort */ }
    }
  }
}

export class TavilyWebSearchDriver implements WebSearchDriver {
  async search(input: { apiKey: string; query: string; maxResults: number; signal: AbortSignal }) {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: input.signal,
      body: JSON.stringify({ api_key: input.apiKey, query: input.query, max_results: input.maxResults, search_depth: 'basic' }),
    })
    if (!response.ok) throw new Error(`Tavily search failed [${response.status}]: ${await response.text()}`)
    const body = await response.json() as { results?: Array<{ title?: string; content?: string; url?: string }> }
    return (body.results || []).map((item) => ({ title: item.title || '', content: (item.content || '').slice(0, 500), url: item.url || '' }))
  }
}

class TranscriptDeduper {
  private readonly recent: Array<{ at: number; text: string }> = []
  shouldEmit(raw: string): boolean {
    const text = raw.trim(); if (!text) return false
    const now = Date.now(); while (this.recent[0] && now - this.recent[0].at > 1200) this.recent.shift()
    if (this.recent.some((item) => item.text === text || item.text.endsWith(text) || text.endsWith(item.text))) return false
    this.recent.push({ at: now, text }); if (this.recent.length > 16) this.recent.shift(); return true
  }
}

export class PcmSpeechSegmenter {
  private residual = new Uint8Array()
  private speech: Uint8Array[] = []
  private silence = 0
  feed(chunk: Uint8Array): Uint8Array[] {
    const data = new Uint8Array(this.residual.length + chunk.length); data.set(this.residual); data.set(chunk, this.residual.length)
    const output: Uint8Array[] = []; let offset = 0
    while (offset + 960 <= data.length) {
      const frame = data.slice(offset, offset + 960); offset += 960
      let energy = 0; const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength)
      for (let index = 0; index < frame.length; index += 2) { const sample = view.getInt16(index, true); energy += sample * sample }
      const isSpeech = Math.sqrt(energy / (frame.length / 2)) >= 500
      if (isSpeech) { this.speech.push(frame); this.silence = 0; if (this.speech.length >= 100) output.push(this.take()) }
      else if (this.speech.length) { this.silence += 1; if (this.silence >= 13) { if (this.speech.length >= 50) output.push(this.take()); else { this.speech = []; this.silence = 0 } } }
    }
    this.residual = data.slice(offset); return output
  }
  private take(): Uint8Array { const size = this.speech.reduce((sum, frame) => sum + frame.length, 0); const value = new Uint8Array(size); let offset = 0; for (const frame of this.speech) { value.set(frame, offset); offset += frame.length }; this.speech = []; this.silence = 0; return value }
  reset(): void { this.residual = new Uint8Array(); this.speech = []; this.silence = 0 }
}

class DashScopeRealtimeAsrSession implements RealtimeAsrSession {
  private socket?: WebSocket
  private ready = false
  private sequence = 0
  private readonly pending: Uint8Array[] = []
  private readonly deduper = new TranscriptDeduper()
  private readonly segmenter = new PcmSpeechSegmenter()
  private readonly roles: Array<{ at: number; role: 'hr' | 'candidate' }> = []
  constructor(private readonly input: { apiKey: string; roleDetector?: VoiceRoleDetector; onInterim(text: string): Promise<void>; onFinal(text: string, role?: 'hr' | 'candidate'): Promise<void>; onError(message: string): Promise<void> }) {}
  private eventId(): string { this.sequence += 1; return `asr-${this.sequence}` }
  async start(): Promise<void> {
    const WebSocketWithHeaders = WebSocket as unknown as new (url: string, options: { headers: Record<string, string> }) => WebSocket
    const socket = new WebSocketWithHeaders('wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime', { headers: { Authorization: `Bearer ${this.input.apiKey}`, 'OpenAI-Beta': 'realtime=v1', 'X-DashScope-DataInspection': 'enable' } })
    this.socket = socket
    await new Promise<void>((resolve, reject) => {
      const failed = (event: Event) => reject(new Error(`DashScope ASR WebSocket failed: ${event.type}`))
      socket.addEventListener('error', failed, { once: true })
      socket.addEventListener('open', () => {
        socket.removeEventListener('error', failed)
        socket.send(JSON.stringify({ event_id: this.eventId(), type: 'session.update', session: { modalities: ['text'], input_audio_format: 'pcm', sample_rate: 16000, turn_detection: { type: 'server_vad', threshold: 0.45, silence_duration_ms: 320 } } }))
        resolve()
      }, { once: true })
    })
    socket.addEventListener('message', (event) => void this.receive(event.data))
    socket.addEventListener('error', () => void this.input.onError('DashScope realtime ASR connection error'))
  }
  private async receive(raw: unknown): Promise<void> {
    if (typeof raw !== 'string') return
    let data: Record<string, unknown>; try { data = JSON.parse(raw) as Record<string, unknown> } catch { return }
    const type = String(data.type || '')
    if (type === 'session.created' || type === 'session.updated') { this.ready = true; for (const bytes of this.pending.splice(0)) this.sendAudio(bytes); return }
    if (type === 'conversation.item.input_audio_transcription.delta' || type === 'conversation.item.input_audio_transcription.text') { const text = String(data.delta || data.text || data.stash || ''); if (text) await this.input.onInterim(text); return }
    if (type === 'conversation.item.input_audio_transcription.completed') { const text = String(data.transcript || data.text || '').trim(); const now = Date.now(); while (this.roles[0] && now - this.roles[0].at > 30_000) this.roles.shift(); if (this.deduper.shouldEmit(text)) await this.input.onFinal(text, this.roles.at(-1)?.role); return }
    if (type === 'error') await this.input.onError(typeof data.error === 'string' ? data.error : JSON.stringify(data.error || data))
  }
  sendAudio(bytes: Uint8Array): boolean {
    if (!bytes.length || !this.socket || this.socket.readyState > WebSocket.OPEN) return false
    if (this.input.roleDetector) for (const segment of this.segmenter.feed(bytes)) void this.input.roleDetector.verify(segment).then((role) => { if (role) { this.roles.push({ at: Date.now(), role }); if (this.roles.length > 64) this.roles.shift() } }).catch(() => undefined)
    if (!this.ready) { if (this.pending.length >= 512) return false; this.pending.push(bytes.slice()); return true }
    if (this.socket.bufferedAmount > 4 * 1024 * 1024) return false
    for (let offset = 0; offset < bytes.length; offset += 3200) {
      const chunk = bytes.slice(offset, offset + 3200)
      this.socket.send(JSON.stringify({ event_id: this.eventId(), type: 'input_audio_buffer.append', audio: Buffer.from(chunk).toString('base64') }))
    }
    return true
  }
  async stop(): Promise<void> {
    const socket = this.socket; this.socket = undefined; this.ready = false; this.pending.splice(0); this.segmenter.reset(); this.roles.splice(0)
    if (!socket) return
    try { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event_id: this.eventId(), type: 'session.finish' })) } catch {}
    if (socket.readyState === WebSocket.CLOSED) return
    await new Promise<void>((resolve) => { const timer = setTimeout(() => { try { socket.close() } catch {}; resolve() }, 1000); socket.addEventListener('close', () => { clearTimeout(timer); resolve() }, { once: true }); try { socket.close() } catch { clearTimeout(timer); resolve() } })
  }
}

export class DashScopeRealtimeAsrFactory implements RealtimeAsrFactory {
  create(input: { apiKey: string; roleDetector?: VoiceRoleDetector; onInterim(text: string): Promise<void>; onFinal(text: string, role?: 'hr' | 'candidate'): Promise<void>; onError(message: string): Promise<void> }): RealtimeAsrSession { return new DashScopeRealtimeAsrSession(input) }
}

function wav(pcm: Uint8Array): Uint8Array {
  const output = new Uint8Array(44 + pcm.length); const view = new DataView(output.buffer); const put = (offset: number, value: string) => output.set(new TextEncoder().encode(value), offset)
  put(0, 'RIFF'); view.setUint32(4, 36 + pcm.length, true); put(8, 'WAVE'); put(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); put(36, 'data'); view.setUint32(40, pcm.length, true); output.set(pcm, 44); return output
}
function sha256(value: string): string { return createHash('sha256').update(value).digest('hex') }
function hmac(key: string | Buffer, value: string): Buffer { return createHmac('sha256', key).update(value).digest() }

class TencentVoiceprintDriver implements VoiceprintDriver {
  constructor(private readonly credentials: VoiceprintCredentials) {}
  private async call(action: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const host = 'asr.tencentcloudapi.com'; const service = 'asr'; const timestamp = Math.floor(Date.now() / 1000); const date = new Date(timestamp * 1000).toISOString().slice(0, 10); const payload = JSON.stringify(params)
    const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`
    const signedHeaders = 'content-type;host;x-tc-action'
    const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(payload)}`
    const scope = `${date}/${service}/tc3_request`; const stringToSign = `TC3-HMAC-SHA256\n${timestamp}\n${scope}\n${sha256(canonicalRequest)}`
    const secretDate = hmac(`TC3${this.credentials.secret_key}`, date); const secretService = hmac(secretDate, service); const secretSigning = hmac(secretService, 'tc3_request'); const signature = createHmac('sha256', secretSigning).update(stringToSign).digest('hex')
    const authorization = `TC3-HMAC-SHA256 Credential=${this.credentials.secret_id}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    const response = await fetch(`https://${host}`, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json; charset=utf-8', Host: host, 'X-TC-Action': action, 'X-TC-Timestamp': String(timestamp), 'X-TC-Version': '2019-06-14', 'X-TC-Region': 'ap-shanghai' }, body: payload })
    const body = await response.json() as { Response?: Record<string, unknown> & { Error?: { Code?: string; Message?: string } } }
    if (!response.ok || body.Response?.Error) throw new Error(body.Response?.Error?.Message || `Tencent VPR failed [${response.status}]`)
    return body.Response || body as Record<string, unknown>
  }
  async ping(): Promise<boolean> { try { await this.call('VoicePrintCount', {}); return true } catch { return false } }
  async enroll(speakerNick: string, pcmBytes: Uint8Array): Promise<string | undefined> {
    try { const audio = wav(pcmBytes); const response = await this.call('VoicePrintEnroll', { VoiceFormat: 0, SampleRate: 16000, SpeakerNick: speakerNick, Data: Buffer.from(audio).toString('base64'), DataLength: audio.length }); const data = response.Data && typeof response.Data === 'object' ? response.Data as Record<string, unknown> : {}; return String(data.VoicePrintId || response.VoicePrintId || '') || undefined } catch { return undefined }
  }
  async verify(voicePrintId: string, pcmBytes: Uint8Array): Promise<{ matched: boolean; score: number } | undefined> {
    try { const audio = wav(pcmBytes); const response = await this.call('VoicePrintVerify', { VoicePrintId: voicePrintId, VoiceFormat: 0, SampleRate: 16000, Data: Buffer.from(audio).toString('base64'), DataLength: audio.length }); const data = response.Data && typeof response.Data === 'object' ? response.Data as Record<string, unknown> : response; const score = Number(data.Score || 0); return { matched: data.Decision === undefined ? score >= 60 : Boolean(data.Decision), score } } catch { return undefined }
  }
  async delete(voicePrintId: string): Promise<boolean> { try { await this.call('VoicePrintDelete', { VoicePrintIdSet: [voicePrintId] }); return true } catch { return false } }
}

export class TencentVoiceprintDriverFactory implements VoiceprintDriverFactory { create(credentials: VoiceprintCredentials): VoiceprintDriver { return new TencentVoiceprintDriver(credentials) } }
