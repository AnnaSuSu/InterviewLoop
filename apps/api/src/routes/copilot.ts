import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import type { UpgradeWebSocket, WSContext, WSMessageReceive } from 'hono/ws'
import { z } from 'zod'
import { CopilotClientMessageSchema, CopilotPrepCreateSchema, CopilotPrepCreatedSchema, CopilotPrepListSchema, CopilotPrepObjectSchema, OkSchema } from '@techspar/contracts'
import type { CopilotPrepUseCases, CopilotRealtimeConnection, CopilotRealtimeUseCases, RequestContext, TokenService } from '@techspar/core'
import { authenticatedContext } from '../http/context.ts'

const PrepPath = z.object({ prep_id: z.string() })

export function registerCopilotRoutes(app: OpenAPIHono, deps: { prep: CopilotPrepUseCases; tokens: TokenService }): void {
  app.openapi(createRoute({ method: 'post', path: '/api/copilot/prep', request: { body: { content: { 'application/x-www-form-urlencoded': { schema: CopilotPrepCreateSchema }, 'multipart/form-data': { schema: CopilotPrepCreateSchema } } } }, responses: { 200: { content: { 'application/json': { schema: CopilotPrepCreatedSchema } }, description: 'Queued Copilot preparation' } } }),
    async (c) => c.json(await deps.prep.start(await authenticatedContext(c, deps.tokens), c.req.valid('form'))))
  app.openapi(createRoute({ method: 'get', path: '/api/copilot/preps', responses: { 200: { content: { 'application/json': { schema: CopilotPrepListSchema } }, description: 'Copilot preparations' } } }),
    async (c) => c.json(await deps.prep.list(await authenticatedContext(c, deps.tokens))))
  app.openapi(createRoute({ method: 'get', path: '/api/copilot/prep/{prep_id}', request: { params: PrepPath }, responses: { 200: { content: { 'application/json': { schema: CopilotPrepObjectSchema } }, description: 'Copilot preparation status' } } }),
    async (c) => c.json(await deps.prep.get(await authenticatedContext(c, deps.tokens), c.req.valid('param').prep_id)))
  app.openapi(createRoute({ method: 'get', path: '/api/copilot/prep/{prep_id}/tree', request: { params: PrepPath }, responses: { 200: { content: { 'application/json': { schema: CopilotPrepObjectSchema } }, description: 'Copilot strategy tree' } } }),
    async (c) => c.json(await deps.prep.tree(await authenticatedContext(c, deps.tokens), c.req.valid('param').prep_id)))
  app.openapi(createRoute({ method: 'delete', path: '/api/copilot/prep/{prep_id}', request: { params: PrepPath }, responses: { 200: { content: { 'application/json': { schema: OkSchema } }, description: 'Deleted Copilot preparation' } } }),
    async (c) => c.json(await deps.prep.delete(await authenticatedContext(c, deps.tokens), c.req.valid('param').prep_id)))
}

function bytes(value: WSMessageReceive): Uint8Array | undefined {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
  return undefined
}

export function registerCopilotWebSocket(app: OpenAPIHono, deps: { realtime: CopilotRealtimeUseCases; tokens: TokenService; upgrade: UpgradeWebSocket }): void {
  app.get('/ws/copilot/:session_id', deps.upgrade(async (c) => {
    const userId = await deps.tokens.decode(c.req.query('token') || '')
    let socket: WSContext | undefined
    let connection: CopilotRealtimeConnection | undefined
    const controller = new AbortController()
    if (userId) {
      const context: RequestContext = { requestId: crypto.randomUUID(), userId, signal: controller.signal }
      connection = deps.realtime.connect(context, c.req.param('session_id') || '', async (event) => { socket?.send(JSON.stringify(event)) })
    }
    return {
      onOpen(_event, ws) { socket = ws; if (!userId) ws.close(1008, 'Authentication required') },
      async onMessage(event, ws) {
        if (!connection) return
        if (typeof event.data !== 'string') { const value = bytes(event.data); if (value) connection.audio(value); return }
        const parsed = CopilotClientMessageSchema.safeParse((() => { try { return JSON.parse(event.data) } catch { return undefined } })())
        if (!parsed.success) { ws.send(JSON.stringify({ type: 'error', message: 'Invalid message' })); return }
        try { await connection.handle(parsed.data) } catch (error) { ws.send(JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : String(error) })) }
      },
      async onClose() { controller.abort(); await connection?.close() },
      async onError() { controller.abort(); await connection?.close() },
    }
  }))
}
