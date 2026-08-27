import { describe, expect, test } from 'bun:test'
import type { OpenAPIHono } from '@hono/zod-openapi'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp, type AppDependencies } from './app.ts'
import { loadExtensions } from './extensions.ts'

function fixture(source: string): string {
  const path = join(mkdtempSync(join(tmpdir(), 'techspar-ext-')), 'extension.ts')
  writeFileSync(path, source)
  return path
}

describe('loadExtensions', () => {
  test('未配置时返回空扩展', async () => {
    expect(await loadExtensions(undefined)).toEqual({})
    expect(await loadExtensions('   ')).toEqual({})
  })

  test('加载默认导出的扩展', async () => {
    const path = fixture('export default { quota: (base) => base }')
    expect(typeof (await loadExtensions(path)).quota).toBe('function')
  })

  test('模块不存在时抛出,不静默降级', async () => {
    expect(loadExtensions(join(tmpdir(), 'techspar-missing-extension.ts'))).rejects.toThrow()
  })

  test('缺少默认导出时抛出', async () => {
    const path = fixture('export const quota = null')
    expect(loadExtensions(path)).rejects.toThrow('必须默认导出')
  })
})

describe('extendRoutes', () => {
  test('扩展路由排在静态前端兜底之前', async () => {
    // 静态前端注册 app.get('*') 且对 /api/* 直接 404,扩展路由挂在它之后就永远
    // 匹配不到。只有同时配了 webDir 才会暴露,所以这里必须把 webDir 一起传上。
    const unavailable = new Proxy({}, { get() { return () => Promise.reject(new Error('unexpected dependency call')) } })
    const webDir = mkdtempSync(join(tmpdir(), 'techspar-web-'))
    writeFileSync(join(webDir, 'index.html'), '<!doctype html>')

    const app = createApp({
      auth: unavailable,
      registration: { allowRegistration: false },
      settings: unavailable,
      quota: unavailable,
      tokens: unavailable,
      knowledge: unavailable,
      resume: unavailable,
      extendRoutes: (instance: OpenAPIHono) => { instance.get('/api/extension-probe', (c) => c.json({ ok: true })) },
      webDir,
    } as unknown as AppDependencies)

    expect((await app.request('/api/extension-probe')).status).toBe(200)
  })
})
