import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadOrCreateRuntimeSecrets } from './runtime-secrets.ts'

const roots: string[] = []
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }) })

describe('desktop runtime secrets', () => {
  test('creates private persistent secrets instead of shipping a fixed desktop key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'techspar-desktop-secret-')); roots.push(root)
    const path = join(root, 'nested', 'runtime-secrets.json')
    const first = await loadOrCreateRuntimeSecrets(path)
    const second = await loadOrCreateRuntimeSecrets(path)
    expect(first).toEqual(second)
    expect(first.jwtSecret).not.toBe(first.voiceprintKey)
    expect(first.jwtSecret).toHaveLength(64)
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
  })
})
