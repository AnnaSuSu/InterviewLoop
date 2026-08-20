import { describe, expect, test } from 'bun:test'
import rootPackage from '../package.json' with { type: 'json' }
import apiPackage from '../apps/api/package.json' with { type: 'json' }
import desktopPackage from '../apps/desktop/package.json' with { type: 'json' }
import { createApp, type AppDependencies } from '../apps/api/src/app.ts'

function versionApp() {
  const unavailable = new Proxy({}, { get() { return () => Promise.reject(new Error('unexpected dependency call')) } })
  return createApp({
    auth: unavailable,
    registration: { allowRegistration: false },
    settings: unavailable,
    quota: unavailable,
    tokens: unavailable,
    knowledge: unavailable,
    resume: unavailable,
  } as unknown as AppDependencies)
}

describe('release version consistency', () => {
  test('keeps package, service, and OpenAPI versions aligned', async () => {
    expect(apiPackage.version).toBe(rootPackage.version)
    expect(desktopPackage.version).toBe(rootPackage.version)

    const app = versionApp()
    const service = await (await app.request('/api/')).json() as { version: string }
    const openapi = await (await app.request('/openapi.json')).json() as { info: { version: string } }
    const generatedOpenapi = await Bun.file('packages/contracts/openapi.json').json() as { info: { version: string } }
    expect(service.version).toBe(rootPackage.version)
    expect(openapi.info.version).toBe(rootPackage.version)
    expect(generatedOpenapi.info.version).toBe(rootPackage.version)
  })
})
