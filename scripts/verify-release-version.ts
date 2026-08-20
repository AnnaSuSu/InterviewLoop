import packageJson from '../package.json' with { type: 'json' }

type VersionedManifest = { name: string; version: string }
type BunLock = { workspaces: Record<string, { version?: string }> }

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

function parseBunLock(source: string): BunLock {
  return JSON.parse(source.replace(/,\s*([}\]])/g, '$1')) as BunLock
}

const tag = process.argv[2] || process.env.GITHUB_REF_NAME
const expected = `v${packageJson.version}`
if (!tag) throw new Error(`Release tag is required; expected ${expected}`)

const lock = parseBunLock(await Bun.file('bun.lock').text())
for (const path of releaseManifestPaths) {
  const manifest = await Bun.file(path).json() as VersionedManifest
  if (manifest.version !== packageJson.version) {
    throw new Error(`${manifest.name} version ${manifest.version} does not match root version ${packageJson.version}`)
  }

  const workspace = path.replace('/package.json', '')
  const lockVersion = lock.workspaces[workspace]?.version
  if (lockVersion !== packageJson.version) {
    throw new Error(`bun.lock workspace ${workspace} version ${lockVersion ?? 'missing'} does not match ${packageJson.version}`)
  }
}

const generatedOpenapi = await Bun.file('packages/contracts/openapi.json').json() as { info?: { version?: string } }
if (generatedOpenapi.info?.version !== packageJson.version) {
  throw new Error(
    `Generated OpenAPI version ${generatedOpenapi.info?.version ?? 'missing'} does not match root version ${packageJson.version}`,
  )
}

if (tag !== expected) throw new Error(`Release tag ${tag} does not match package version ${packageJson.version}; expected ${expected}`)
console.log(`Release version verified: ${tag}`)
