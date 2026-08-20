import packageJson from '../package.json' with { type: 'json' }
import desktopPackageJson from '../apps/desktop/package.json' with { type: 'json' }

const tag = process.argv[2] || process.env.GITHUB_REF_NAME
const expected = `v${packageJson.version}`
if (!tag) throw new Error(`Release tag is required; expected ${expected}`)
if (desktopPackageJson.version !== packageJson.version) {
  throw new Error(
    `Desktop version ${desktopPackageJson.version} does not match root version ${packageJson.version}`,
  )
}
if (tag !== expected) throw new Error(`Release tag ${tag} does not match package version ${packageJson.version}; expected ${expected}`)
console.log(`Release version verified: ${tag}`)
