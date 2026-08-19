import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import {
  BinarySchema,
  OkSchema,
  ResumeParsedSchema,
  ResumeStatusSchema,
  ResumeUploadedSchema,
  ResumeUploadSchema,
  TranscriptionSchema,
} from '@techspar/contracts'
import type { ResumeUseCases, TokenService } from '@techspar/core'
import { authenticatedContext } from '../http/context.ts'

export function registerResumeRoutes(
  app: OpenAPIHono,
  deps: { resume: ResumeUseCases; tokens: TokenService },
): void {
  app.openapi(createRoute({ method: 'get', path: '/api/resume/status', responses: { 200: { content: { 'application/json': { schema: ResumeStatusSchema } }, description: 'Resume status' } } }),
    async (c) => c.json(await deps.resume.status(await authenticatedContext(c, deps.tokens))))

  app.openapi(createRoute({ method: 'get', path: '/api/resume/file', responses: { 200: { content: { 'application/pdf': { schema: BinarySchema } }, description: 'Resume PDF' } } }),
    async (c) => {
      const file = await deps.resume.file(await authenticatedContext(c, deps.tokens))
      return new Response(file.bytes as unknown as BodyInit, { headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}` } })
    })

  app.openapi(createRoute({ method: 'delete', path: '/api/resume', responses: { 200: { content: { 'application/json': { schema: OkSchema } }, description: 'Deleted resume' } } }),
    async (c) => c.json(await deps.resume.delete(await authenticatedContext(c, deps.tokens))))

  app.openapi(createRoute({ method: 'post', path: '/api/resume/parse', responses: { 200: { content: { 'application/json': { schema: ResumeParsedSchema } }, description: 'Parsed resume' } } }),
    async (c) => c.json(await deps.resume.parse(await authenticatedContext(c, deps.tokens))))

  app.openapi(createRoute({ method: 'post', path: '/api/resume/upload', request: { body: { content: { 'multipart/form-data': { schema: ResumeUploadSchema } } } }, responses: { 200: { content: { 'application/json': { schema: ResumeUploadedSchema } }, description: 'Uploaded resume' } } }),
    async (c) => { const file = c.req.valid('form').file; return c.json(await deps.resume.upload(await authenticatedContext(c, deps.tokens), file.name, new Uint8Array(await file.arrayBuffer()))) })

  app.openapi(createRoute({ method: 'post', path: '/api/transcribe', request: { body: { content: { 'multipart/form-data': { schema: ResumeUploadSchema } } } }, responses: { 200: { content: { 'application/json': { schema: TranscriptionSchema } }, description: 'Transcribed audio' } } }),
    async (c) => { const file = c.req.valid('form').file; return c.json(await deps.resume.transcribe(await authenticatedContext(c, deps.tokens), file.name || 'audio.webm', new Uint8Array(await file.arrayBuffer()))) })
}
