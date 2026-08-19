import { describe, expect, test } from 'bun:test'
import { createApp, type AppDependencies } from '../../apps/api/src/app.ts'

type Spec = { paths: Record<string, Record<string, unknown>> }
const HTTP = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head'])
function operations(spec: Spec): string[] { return Object.entries(spec.paths).flatMap(([path, item]) => Object.keys(item).filter((method) => HTTP.has(method)).map((method) => `${method.toUpperCase()} ${path}`)).sort() }

describe('FastAPI to Hono contract inventory', () => {
  test('keeps every legacy HTTP method and path', async () => {
    const baseline = await Bun.file('tests-ts/contracts/fastapi-openapi.json').json() as Spec
    const unavailable = new Proxy({}, { get() { return () => Promise.reject(new Error('not called while generating OpenAPI')) } })
    const deps = {
      auth: unavailable, registration: { allowRegistration: false }, settings: unavailable, settingsOperations: unavailable, quota: unavailable, tokens: unavailable,
      knowledge: unavailable, resume: unavailable, interview: unavailable, profile: unavailable, personalAgent: unavailable, migration: unavailable, recording: unavailable,
      copilotPrep: unavailable, copilotRealtime: unavailable, voiceprint: unavailable,
    } as unknown as AppDependencies
    const response = await createApp(deps).request('/openapi.json')
    expect(response.status).toBe(200)
    const current = await response.json() as Spec
    expect(operations(current)).toEqual(operations(baseline))
    expect(operations(current)).toHaveLength(71)
  })
})
