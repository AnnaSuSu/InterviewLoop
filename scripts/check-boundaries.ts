import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const forbidden = /(?:from\s+['"](?:@techspar\/(?:db|platform|providers)|hono(?:\/|['"])|@hono\/|bun:|electron)|\bBun\.)/
const roots = ['packages/core/src', 'packages/contracts/src']
const violations: string[] = []

async function walk(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await walk(path)
    else if (entry.name.endsWith('.ts') && forbidden.test(await Bun.file(path).text())) violations.push(path)
  }
}

for (const root of roots) await walk(root)
if (violations.length) {
  console.error(`Runtime boundary violations:\n${violations.join('\n')}`)
  process.exit(1)
}
console.log('Runtime boundaries OK')
