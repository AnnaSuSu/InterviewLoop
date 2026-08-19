import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import { z } from 'zod'
import { OkSchema, PersonalAgentChatSchema, PersonalAgentObjectSchema, PersonalDocumentUploadSchema } from '@techspar/contracts'
import type { PersonalAgentUseCases, TokenService } from '@techspar/core'
import { authenticatedContext } from '../http/context.ts'

const DocumentPath = z.object({ document_id: z.string() })
const ConversationPath = z.object({ conversation_id: z.string() })

export function registerPersonalAgentRoutes(app: OpenAPIHono, deps: { personalAgent: PersonalAgentUseCases; tokens: TokenService }): void {
  app.openapi(createRoute({ method: 'get', path: '/api/personal-agent/documents', responses: { 200: { content: { 'application/json': { schema: PersonalAgentObjectSchema } }, description: 'Documents' } } }),
    async (c) => c.json(await deps.personalAgent.documents(await authenticatedContext(c, deps.tokens))))

  app.openapi(createRoute({ method: 'post', path: '/api/personal-agent/documents', request: { body: { content: { 'multipart/form-data': { schema: PersonalDocumentUploadSchema } } } }, responses: { 200: { content: { 'application/json': { schema: PersonalAgentObjectSchema } }, description: 'Upload document' } } }),
    async (c) => { const file = c.req.valid('form').file; return c.json(await deps.personalAgent.upload(await authenticatedContext(c, deps.tokens), file.name || 'document', new Uint8Array(await file.arrayBuffer()))) })

  app.openapi(createRoute({ method: 'delete', path: '/api/personal-agent/documents/{document_id}', request: { params: DocumentPath }, responses: { 200: { content: { 'application/json': { schema: OkSchema } }, description: 'Delete document' } } }),
    async (c) => c.json(await deps.personalAgent.deleteDocument(await authenticatedContext(c, deps.tokens), c.req.valid('param').document_id)))

  app.openapi(createRoute({ method: 'get', path: '/api/personal-agent/conversations', responses: { 200: { content: { 'application/json': { schema: PersonalAgentObjectSchema } }, description: 'Conversations' } } }),
    async (c) => c.json(await deps.personalAgent.conversations(await authenticatedContext(c, deps.tokens))))

  app.openapi(createRoute({ method: 'get', path: '/api/personal-agent/conversations/{conversation_id}', request: { params: ConversationPath }, responses: { 200: { content: { 'application/json': { schema: PersonalAgentObjectSchema } }, description: 'Conversation' } } }),
    async (c) => c.json(await deps.personalAgent.conversation(await authenticatedContext(c, deps.tokens), c.req.valid('param').conversation_id)))

  app.openapi(createRoute({ method: 'delete', path: '/api/personal-agent/conversations/{conversation_id}', request: { params: ConversationPath }, responses: { 200: { content: { 'application/json': { schema: OkSchema } }, description: 'Delete conversation' } } }),
    async (c) => c.json(await deps.personalAgent.deleteConversation(await authenticatedContext(c, deps.tokens), c.req.valid('param').conversation_id)))

  app.openapi(createRoute({ method: 'post', path: '/api/personal-agent/chat', request: { body: { content: { 'application/json': { schema: PersonalAgentChatSchema } } } }, responses: { 200: { content: { 'application/json': { schema: PersonalAgentObjectSchema } }, description: 'Personal agent chat' } } }),
    async (c) => { const body = c.req.valid('json'); return c.json(await deps.personalAgent.chat(await authenticatedContext(c, deps.tokens), body.message, body.conversation_id)) })
}
