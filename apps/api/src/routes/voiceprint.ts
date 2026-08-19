import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import { OkSchema, VoiceprintCredentialsSchema, VoiceprintEnrolledSchema, VoiceprintStatusSchema, VoiceprintUploadSchema } from '@techspar/contracts'
import type { TokenService, VoiceprintUseCases } from '@techspar/core'
import { authenticatedContext } from '../http/context.ts'

export function registerVoiceprintRoutes(app: OpenAPIHono, deps: { voiceprint: VoiceprintUseCases; tokens: TokenService }): void {
  app.openapi(createRoute({ method: 'get', path: '/api/voiceprint/status', responses: { 200: { content: { 'application/json': { schema: VoiceprintStatusSchema } }, description: 'Voiceprint status' } } }),
    async (c) => c.json(await deps.voiceprint.status(await authenticatedContext(c, deps.tokens))))
  app.openapi(createRoute({ method: 'put', path: '/api/voiceprint/credentials', request: { body: { content: { 'application/json': { schema: VoiceprintCredentialsSchema } } } }, responses: { 200: { content: { 'application/json': { schema: OkSchema } }, description: 'Saved voiceprint credentials' } } }),
    async (c) => c.json(await deps.voiceprint.credentials(await authenticatedContext(c, deps.tokens), c.req.valid('json'))))
  app.openapi(createRoute({ method: 'post', path: '/api/voiceprint/enroll', request: { body: { content: { 'multipart/form-data': { schema: VoiceprintUploadSchema } } } }, responses: { 200: { content: { 'application/json': { schema: VoiceprintEnrolledSchema } }, description: 'Enrolled voiceprint' } } }),
    async (c) => { const body = c.req.valid('form'); return c.json(await deps.voiceprint.enroll(await authenticatedContext(c, deps.tokens), new Uint8Array(await body.file.arrayBuffer()))) })
  app.openapi(createRoute({ method: 'delete', path: '/api/voiceprint/enroll', responses: { 200: { content: { 'application/json': { schema: OkSchema } }, description: 'Deleted voiceprint enrollment' } } }),
    async (c) => c.json(await deps.voiceprint.unenroll(await authenticatedContext(c, deps.tokens))))
}
