import { describe, expect, test } from 'bun:test'
import rootPackage from '../package.json' with { type: 'json' }
import { createApp, type AppDependencies } from '../apps/api/src/app.ts'

const releaseManifestPaths = [
  'apps/api/package.json',
  'apps/desktop/package.json',
  'packages/contracts/package.json',
  'packages/core/package.json',
  'packages/db/package.json',
  'packages/platform/package.json',
  'packages/providers/package.json',
  'packages/testing/package.json',
] as const

function parseBunLock(source: string) {
  return JSON.parse(source.replace(/,\s*([}\]])/g, '$1')) as {
    workspaces: Record<string, { version?: string }>
  }
}

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
    const lock = parseBunLock(await Bun.file('bun.lock').text())
    for (const path of releaseManifestPaths) {
      const manifest = await Bun.file(path).json() as { version: string }
      expect(manifest.version).toBe(rootPackage.version)
      expect(lock.workspaces[path.replace('/package.json', '')]?.version).toBe(rootPackage.version)
    }

    const app = versionApp()
    const service = await (await app.request('/api/')).json() as { version: string }
    const openapi = await (await app.request('/openapi.json')).json() as { info: { version: string } }
    const generatedOpenapi = await Bun.file('packages/contracts/openapi.json').json() as { info: { version: string } }
    expect(service.version).toBe(rootPackage.version)
    expect(openapi.info.version).toBe(rootPackage.version)
    expect(generatedOpenapi.info.version).toBe(rootPackage.version)
  })
})
