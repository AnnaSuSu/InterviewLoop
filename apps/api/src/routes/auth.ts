import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import {
  AuthConfigSchema,
  AuthResponseSchema,
  LoginRequestSchema,
  RegisterRequestSchema,
  ServiceInfoSchema,
} from '@techspar/contracts'
import type { AuthPolicy, AuthUseCases } from '@techspar/core'

export function registerAuthRoutes(
  app: OpenAPIHono,
  deps: { auth: AuthUseCases; registration: AuthPolicy },
): void {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/',
      responses: { 200: { content: { 'application/json': { schema: ServiceInfoSchema } }, description: 'Service info' } },
    }),
    (c) => c.json({ service: 'TechSpar' as const, version: '0.2.0' }),
  )

  app.openapi(
    createRoute({
      method: 'get',
      path: '/api/auth/config',
      responses: { 200: { content: { 'application/json': { schema: AuthConfigSchema } }, description: 'Registration configuration' } },
    }),
    (c) => c.json({ allow_registration: deps.registration.allowRegistration }),
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/auth/login',
      request: { body: { content: { 'application/json': { schema: LoginRequestSchema } } } },
      responses: { 200: { content: { 'application/json': { schema: AuthResponseSchema } }, description: 'Authenticated user' } },
    }),
    async (c) => {
      const body = c.req.valid('json')
      return c.json(await deps.auth.login(body.email, body.password))
    },
  )

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/auth/register',
      request: { body: { content: { 'application/json': { schema: RegisterRequestSchema } } } },
      responses: { 200: { content: { 'application/json': { schema: AuthResponseSchema } }, description: 'Registered user' } },
    }),
    async (c) => {
      const body = c.req.valid('json')
      return c.json(await deps.auth.register(body.email, body.password, body.name))
    },
  )
}
