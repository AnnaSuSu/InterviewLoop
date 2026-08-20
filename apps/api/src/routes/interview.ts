import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import {
  EndInterviewSchema,
  InterviewChatSchema,
  InterviewModeSchema,
  InterviewObjectSchema,
  InterviewTopicsSchema,
  JobPrepPreviewSchema,
  JobPrepStartSchema,
  OkSchema,
  ReferenceAnswerRequestSchema,
  ReferenceAnswerResponseSchema,
  StartInterviewSchema,
  TaskStatusSchema,
} from '@techspar/contracts'
import type { InterviewUseCases, TokenService } from '@techspar/core'
import { authenticatedContext } from '../http/context.ts'

const SessionPath = z.object({ session_id: z.string() })
const TaskPath = z.object({ task_id: z.string() })

export function registerInterviewRoutes(app: OpenAPIHono, deps: { interview: InterviewUseCases; tokens: TokenService }): void {
  app.openapi(createRoute({ method: 'post', path: '/api/job-prep/preview', request: { body: { content: { 'application/json': { schema: JobPrepPreviewSchema } } } }, responses: { 200: { content: { 'application/json': { schema: InterviewObjectSchema } }, description: 'JD preview' } } }),
    async (c) => { const body = c.req.valid('json'); return c.json(await deps.interview.previewJob(await authenticatedContext(c, deps.tokens), { ...body, company: body.company ?? undefined, position: body.position ?? undefined })) })

  app.openapi(createRoute({ method: 'post', path: '/api/job-prep/start', request: { body: { content: { 'application/json': { schema: JobPrepStartSchema } } } }, responses: { 200: { content: { 'application/json': { schema: InterviewObjectSchema } }, description: 'Start JD interview' } } }),
    async (c) => { const body = c.req.valid('json'); return c.json(await deps.interview.startJob(await authenticatedContext(c, deps.tokens), { ...body, company: body.company ?? undefined, position: body.position ?? undefined })) })

  app.openapi(createRoute({ method: 'post', path: '/api/interview/start', request: { body: { content: { 'application/json': { schema: StartInterviewSchema } } } }, responses: { 200: { content: { 'application/json': { schema: InterviewObjectSchema } }, description: 'Start interview' } } }),
    async (c) => { const body = c.req.valid('json'); return c.json(await deps.interview.start(await authenticatedContext(c, deps.tokens), { ...body, topic: body.topic ?? undefined })) })

  app.openapi(createRoute({ method: 'post', path: '/api/interview/chat', request: { body: { content: { 'application/json': { schema: InterviewChatSchema } } } }, responses: { 200: { content: { 'application/json': { schema: InterviewObjectSchema } }, description: 'Interview turn' } } }),
    async (c) => { const body = c.req.valid('json'); return c.json(await deps.interview.chat(await authenticatedContext(c, deps.tokens), body.session_id, body.message)) })

  app.openapi(createRoute({
    method: 'post', path: '/api/interview/chat/stream',
    request: { body: { content: { 'application/json': { schema: InterviewChatSchema } } } },
    responses: { 200: { content: { 'text/event-stream': { schema: z.string() } }, description: 'Interview response stream' } },
  }), async (c) => {
    const parsed = InterviewChatSchema.safeParse(await c.req.json())
    if (!parsed.success) return c.json({ detail: parsed.error.message }, 422)
    const context = await authenticatedContext(c, deps.tokens)
    return streamSSE(c, async (stream) => {
      try {
        for await (const event of deps.interview.chatStream(context, parsed.data.session_id, parsed.data.message)) await stream.writeSSE({ data: JSON.stringify(event) })
      } catch (error) {
        await stream.writeSSE({ data: JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) })
      }
    })
  })

  app.openapi(createRoute({ method: 'post', path: '/api/interview/end/{session_id}', request: { params: SessionPath, body: { required: false, content: { 'application/json': { schema: EndInterviewSchema } } } }, responses: { 200: { content: { 'application/json': { schema: InterviewObjectSchema } }, description: 'End interview' } } }),
    async (c) => c.json(await deps.interview.end(await authenticatedContext(c, deps.tokens), c.req.valid('param').session_id, c.req.valid('json')?.answers || [])))

  app.openapi(createRoute({ method: 'post', path: '/api/interview/draft/{session_id}', request: { params: SessionPath, body: { content: { 'application/json': { schema: EndInterviewSchema } } } }, responses: { 200: { content: { 'application/json': { schema: InterviewObjectSchema } }, description: 'Save draft' } } }),
    async (c) => c.json(await deps.interview.draft(await authenticatedContext(c, deps.tokens), c.req.valid('param').session_id, c.req.valid('json').answers)))

  app.openapi(createRoute({ method: 'post', path: '/api/interview/review/{session_id}/generate', request: { params: SessionPath }, responses: { 200: { content: { 'application/json': { schema: InterviewObjectSchema } }, description: 'Generate review' } } }),
    async (c) => c.json(await deps.interview.generateReview(await authenticatedContext(c, deps.tokens), c.req.valid('param').session_id)))

  app.openapi(createRoute({ method: 'get', path: '/api/interview/session/{session_id}/resume', request: { params: SessionPath }, responses: { 200: { content: { 'application/json': { schema: InterviewObjectSchema } }, description: 'Resume session' } } }),
    async (c) => c.json(await deps.interview.resume(await authenticatedContext(c, deps.tokens), c.req.valid('param').session_id)))

  app.openapi(createRoute({ method: 'post', path: '/api/interview/reference-answer', request: { body: { content: { 'application/json': { schema: ReferenceAnswerRequestSchema } } } }, responses: { 200: { content: { 'application/json': { schema: ReferenceAnswerResponseSchema } }, description: 'Reference answer' } } }),
    async (c) => { const body = c.req.valid('json'); return c.json(await deps.interview.referenceAnswer(await authenticatedContext(c, deps.tokens), body.session_id, body.question_id)) })

  app.openapi(createRoute({ method: 'get', path: '/api/interview/review/{session_id}', request: { params: SessionPath }, responses: { 200: { content: { 'application/json': { schema: InterviewObjectSchema } }, description: 'Review' } } }),
    async (c) => c.json(await deps.interview.review(await authenticatedContext(c, deps.tokens), c.req.valid('param').session_id)))

  app.openapi(createRoute({ method: 'get', path: '/api/tasks/{task_id}', request: { params: TaskPath }, responses: { 200: { content: { 'application/json': { schema: TaskStatusSchema } }, description: 'Task status' } } }),
    async (c) => c.json(TaskStatusSchema.parse(await deps.interview.task(await authenticatedContext(c, deps.tokens), c.req.valid('param').task_id))))

  app.openapi(createRoute({ method: 'get', path: '/api/interview/history', request: { query: z.object({ limit: z.coerce.number().int().optional(), offset: z.coerce.number().int().optional(), mode: InterviewModeSchema.optional(), topic: z.string().optional() }) }, responses: { 200: { content: { 'application/json': { schema: InterviewObjectSchema } }, description: 'History' } } }),
    async (c) => c.json(await deps.interview.history(await authenticatedContext(c, deps.tokens), c.req.valid('query'))))

  app.openapi(createRoute({ method: 'delete', path: '/api/interview/session/{session_id}', request: { params: SessionPath }, responses: { 200: { content: { 'application/json': { schema: OkSchema } }, description: 'Delete session' } } }),
    async (c) => c.json(await deps.interview.delete(await authenticatedContext(c, deps.tokens), c.req.valid('param').session_id)))

  app.openapi(createRoute({ method: 'get', path: '/api/interview/topics', responses: { 200: { content: { 'application/json': { schema: InterviewTopicsSchema } }, description: 'Interview topics' } } }),
    async (c) => c.json(await deps.interview.topics(await authenticatedContext(c, deps.tokens))))
}
