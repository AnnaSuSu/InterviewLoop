import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import {
  CreateKnowledgeSchema,
  CreateTopicSchema,
  KnowledgeContentSchema,
  KnowledgeCreatedSchema,
  KnowledgeFilesSchema,
  KnowledgeGeneratedSchema,
  KnowledgeUploadSchema,
  OkSchema,
  QuestionGraphSchema,
  TopicCreatedSchema,
  TopicMapSchema,
} from '@techspar/contracts'
import type { KnowledgeUseCases, TokenService } from '@techspar/core'
import { z } from 'zod'
import { authenticatedContext } from '../http/context.ts'

const topicParam = z.object({ topic: z.string() })
const keyParam = z.object({ key: z.string() })
const coreParam = z.object({ topic: z.string(), filename: z.string() })

export function registerKnowledgeRoutes(
  app: OpenAPIHono,
  deps: { knowledge: KnowledgeUseCases; tokens: TokenService },
): void {
  app.openapi(createRoute({ method: 'get', path: '/api/topics', responses: { 200: { content: { 'application/json': { schema: TopicMapSchema } }, description: 'Topics' } } }),
    async (c) => c.json(await deps.knowledge.topics(await authenticatedContext(c, deps.tokens))))

  app.openapi(createRoute({ method: 'post', path: '/api/topics', request: { body: { content: { 'application/json': { schema: CreateTopicSchema } } } }, responses: { 200: { content: { 'application/json': { schema: TopicCreatedSchema } }, description: 'Created topic' } } }),
    async (c) => c.json(await deps.knowledge.createTopic(await authenticatedContext(c, deps.tokens), c.req.valid('json'))))

  app.openapi(createRoute({ method: 'delete', path: '/api/topics/{key}', request: { params: keyParam }, responses: { 200: { content: { 'application/json': { schema: OkSchema } }, description: 'Deleted topic' } } }),
    async (c) => c.json(await deps.knowledge.deleteTopic(await authenticatedContext(c, deps.tokens), c.req.valid('param').key)))

  app.openapi(createRoute({ method: 'get', path: '/api/knowledge/{topic}/core', request: { params: topicParam }, responses: { 200: { content: { 'application/json': { schema: KnowledgeFilesSchema } }, description: 'Core knowledge files' } } }),
    async (c) => c.json(await deps.knowledge.listCore(await authenticatedContext(c, deps.tokens), c.req.valid('param').topic)))

  app.openapi(createRoute({ method: 'post', path: '/api/knowledge/{topic}/core', request: { params: topicParam, body: { content: { 'application/json': { schema: CreateKnowledgeSchema } } } }, responses: { 200: { content: { 'application/json': { schema: KnowledgeCreatedSchema } }, description: 'Created knowledge file' } } }),
    async (c) => c.json(await deps.knowledge.createCore(await authenticatedContext(c, deps.tokens), c.req.valid('param').topic, c.req.valid('json'))))

  app.openapi(createRoute({ method: 'put', path: '/api/knowledge/{topic}/core/{filename}', request: { params: coreParam, body: { content: { 'application/json': { schema: KnowledgeContentSchema } } } }, responses: { 200: { content: { 'application/json': { schema: OkSchema } }, description: 'Updated knowledge file' } } }),
    async (c) => { const param = c.req.valid('param'); return c.json(await deps.knowledge.updateCore(await authenticatedContext(c, deps.tokens), param.topic, param.filename, c.req.valid('json').content)) })

  app.openapi(createRoute({ method: 'delete', path: '/api/knowledge/{topic}/core/{filename}', request: { params: coreParam }, responses: { 200: { content: { 'application/json': { schema: OkSchema } }, description: 'Deleted knowledge file' } } }),
    async (c) => { const param = c.req.valid('param'); return c.json(await deps.knowledge.deleteCore(await authenticatedContext(c, deps.tokens), param.topic, param.filename)) })

  app.openapi(createRoute({ method: 'post', path: '/api/knowledge/{topic}/upload', request: { params: topicParam, body: { content: { 'multipart/form-data': { schema: KnowledgeUploadSchema } } } }, responses: { 200: { content: { 'application/json': { schema: KnowledgeCreatedSchema } }, description: 'Imported knowledge file' } } }),
    async (c) => { const file = c.req.valid('form').file; return c.json(await deps.knowledge.importCore(await authenticatedContext(c, deps.tokens), c.req.valid('param').topic, file.name, new Uint8Array(await file.arrayBuffer()))) })

  app.openapi(createRoute({ method: 'post', path: '/api/knowledge/{topic}/generate', request: { params: topicParam }, responses: { 200: { content: { 'application/json': { schema: KnowledgeGeneratedSchema } }, description: 'Generated knowledge' } } }),
    async (c) => c.json(await deps.knowledge.generateCore(await authenticatedContext(c, deps.tokens), c.req.valid('param').topic)))

  app.openapi(createRoute({ method: 'get', path: '/api/knowledge/{topic}/high_freq', request: { params: topicParam }, responses: { 200: { content: { 'application/json': { schema: KnowledgeContentSchema } }, description: 'High frequency questions' } } }),
    async (c) => c.json(await deps.knowledge.getHighFrequency(await authenticatedContext(c, deps.tokens), c.req.valid('param').topic)))

  app.openapi(createRoute({ method: 'put', path: '/api/knowledge/{topic}/high_freq', request: { params: topicParam, body: { content: { 'application/json': { schema: KnowledgeContentSchema } } } }, responses: { 200: { content: { 'application/json': { schema: OkSchema } }, description: 'Updated high frequency questions' } } }),
    async (c) => c.json(await deps.knowledge.updateHighFrequency(await authenticatedContext(c, deps.tokens), c.req.valid('param').topic, c.req.valid('json').content)))

  app.openapi(createRoute({ method: 'get', path: '/api/graph/{topic}', request: { params: topicParam }, responses: { 200: { content: { 'application/json': { schema: QuestionGraphSchema } }, description: 'Question graph' } } }),
    async (c) => c.json(await deps.knowledge.graph(await authenticatedContext(c, deps.tokens), c.req.valid('param').topic)))
}
