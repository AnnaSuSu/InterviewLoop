import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
