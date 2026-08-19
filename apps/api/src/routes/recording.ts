import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import { RecordingAnalyzeResponseSchema, RecordingAnalyzeSchema, RecordingTranscriptionSchema, RecordingTranscriptionUploadSchema } from '@techspar/contracts'
import type { RecordingUseCases, TokenService } from '@techspar/core'
import { authenticatedContext } from '../http/context.ts'

export function registerRecordingRoutes(app: OpenAPIHono, deps: { recording: RecordingUseCases; tokens: TokenService }): void {
  app.openapi(createRoute({
    method: 'post', path: '/api/recording/transcribe',
    request: { body: { content: { 'multipart/form-data': { schema: RecordingTranscriptionUploadSchema } } } },
    responses: { 200: { content: { 'application/json': { schema: RecordingTranscriptionSchema } }, description: 'Recording transcript' } },
  }), async (c) => {
    const body = c.req.valid('form')
    return c.json(await deps.recording.transcribe(await authenticatedContext(c, deps.tokens), body.file.name || 'recording.webm', new Uint8Array(await body.file.arrayBuffer()), body.mode))
  })

  app.openapi(createRoute({
    method: 'post', path: '/api/recording/analyze',
    request: { body: { content: { 'application/json': { schema: RecordingAnalyzeSchema } } } },
    responses: { 200: { content: { 'application/json': { schema: RecordingAnalyzeResponseSchema } }, description: 'Queued recording analysis' } },
  }), async (c) => c.json(await deps.recording.analyze(await authenticatedContext(c, deps.tokens), c.req.valid('json'))))
}
