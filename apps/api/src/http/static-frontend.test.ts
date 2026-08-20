import { afterEach, describe, expect, test } from 'bun:test'
import { OpenAPIHono } from '@hono/zod-openapi'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { registerStaticFrontend } from './static-frontend.ts'

const roots: string[] = []
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }) })

describe('packaged frontend host', () => {
  test('serves immutable assets, SPA routes, and restrictive security headers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'techspar-web-')); roots.push(root)
    await mkdir(join(root, 'assets'))
    await Bun.write(join(root, 'index.html'), '<main>TechSpar</main>')
    await Bun.write(join(root, 'assets/app.js'), 'export {}')
    const app = new OpenAPIHono()
    app.get('/api/live', (c) => c.json({ ok: true }))
    registerStaticFrontend(app, root)

    expect(await (await app.request('/dashboard')).text()).toContain('TechSpar')
    const asset = await app.request('/assets/app.js')
    expect(asset.headers.get('content-type')).toContain('text/javascript')
    expect(asset.headers.get('cache-control')).toContain('immutable')
    expect(asset.headers.get('content-security-policy')).toContain("script-src 'self'")
    expect(await (await app.request('/api/live')).json()).toEqual({ ok: true })
    expect((await app.request('/api/missing')).status).toBe(404)
    expect((await app.request('/%2e%2e%2fsecret.txt')).status).toBe(404)
  })
})
