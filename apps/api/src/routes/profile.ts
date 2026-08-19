import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import { z } from 'zod'
import { ProfileFeedbackSchema, ProfileSchema, RetrospectiveTaskSchema, TargetRoleSchema } from '@techspar/contracts'
import type { ProfileUseCases, TokenService } from '@techspar/core'
import { authenticatedContext } from '../http/context.ts'

const TopicPath = z.object({ topic: z.string() })

export function registerProfileRoutes(app: OpenAPIHono, deps: { profile: ProfileUseCases; tokens: TokenService }): void {
  app.openapi(createRoute({ method: 'get', path: '/api/profile', responses: { 200: { content: { 'application/json': { schema: ProfileSchema } }, description: 'Candidate profile' } } }),
    async (c) => c.json(await deps.profile.get(await authenticatedContext(c, deps.tokens))))

  app.openapi(createRoute({ method: 'post', path: '/api/profile/infer-target-role', responses: { 200: { content: { 'application/json': { schema: TargetRoleSchema } }, description: 'Infer role' } } }),
    async (c) => c.json(await deps.profile.inferTargetRole(await authenticatedContext(c, deps.tokens))))

  app.openapi(createRoute({ method: 'post', path: '/api/profile/viewed', responses: { 200: { content: { 'application/json': { schema: ProfileSchema } }, description: 'Mark profile viewed' } } }),
    async (c) => c.json(await deps.profile.viewed(await authenticatedContext(c, deps.tokens))))

  app.openapi(createRoute({ method: 'post', path: '/api/profile/pattern/feedback', request: { body: { content: { 'application/json': { schema: ProfileFeedbackSchema } } } }, responses: { 200: { content: { 'application/json': { schema: ProfileSchema } }, description: 'Pattern feedback' } } }),
    async (c) => { const body = c.req.valid('json'); return c.json(await deps.profile.feedback(await authenticatedContext(c, deps.tokens), body.point, body.verdict)) })

  app.openapi(createRoute({ method: 'get', path: '/api/profile/due-reviews', request: { query: z.object({ topic: z.string().optional() }) }, responses: { 200: { content: { 'application/json': { schema: z.array(ProfileSchema) } }, description: 'Due reviews' } } }),
    async (c) => c.json(await deps.profile.dueReviews(await authenticatedContext(c, deps.tokens), c.req.valid('query').topic)))

  app.openapi(createRoute({ method: 'get', path: '/api/profile/topic/{topic}/history', request: { params: TopicPath }, responses: { 200: { content: { 'application/json': { schema: z.array(ProfileSchema) } }, description: 'Topic history' } } }),
    async (c) => c.json(await deps.profile.topicHistory(await authenticatedContext(c, deps.tokens), c.req.valid('param').topic) as Record<string, unknown>[]))

  app.openapi(createRoute({ method: 'post', path: '/api/profile/topic/{topic}/retrospective', request: { params: TopicPath }, responses: { 200: { content: { 'application/json': { schema: RetrospectiveTaskSchema } }, description: 'Generate retrospective' } } }),
    async (c) => c.json(await deps.profile.retrospective(await authenticatedContext(c, deps.tokens), c.req.valid('param').topic)))
}
