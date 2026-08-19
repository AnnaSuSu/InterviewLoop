import type { Context } from 'hono'
import { AuthenticationError, type RequestContext, type TokenService } from '@techspar/core'

export async function authenticatedContext(c: Context, tokens: TokenService): Promise<RequestContext> {
  const authorization = c.req.header('authorization') || ''
  const [scheme, token] = authorization.split(' ', 2)
  if (scheme?.toLowerCase() !== 'bearer' || !token) throw new AuthenticationError()
  const userId = await tokens.decode(token)
  if (!userId) throw new AuthenticationError()
  return { requestId: crypto.randomUUID(), userId, signal: c.req.raw.signal }
}
