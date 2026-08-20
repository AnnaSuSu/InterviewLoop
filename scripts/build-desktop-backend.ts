import { chmod, cp, mkdir, readdir, realpath, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const root = process.cwd()
const argument = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const targetPlatform = argument('platform') || process.platform
const targetArch = argument('arch') || process.arch
const supportedPlatforms = new Set(['darwin', 'linux', 'win32'])
const supportedArchitectures = new Set(['arm64', 'x64'])
if (!supportedPlatforms.has(targetPlatform) || !supportedArchitectures.has(targetArch)) {
  throw new Error(`Unsupported desktop backend target: ${targetPlatform}-${targetArch}`)
}
const bunPlatform = targetPlatform === 'win32' ? 'windows' : targetPlatform
const compileTarget = `bun-${bunPlatform}-${targetArch}` as Bun.Build.CompileTarget
const executableName = targetPlatform === 'win32' ? 'techspar-api.exe' : 'techspar-api'
const output = join(root, 'apps', 'desktop', 'resources', 'backend', executableName)
const runtimeOutput = join(dirname(output), 'onnxruntime')
const buildScratchPattern = /^\.[a-f0-9]+-\d+\.bun-build$/

await rm(dirname(output), { recursive: true, force: true })
await mkdir(dirname(output), { recursive: true })
const sharpStub = resolve(root, 'scripts', 'desktop-sharp-stub.ts')
const filesBeforeBuild = new Set(await readdir(root))
let build: Awaited<ReturnType<typeof Bun.build>>
try {
  build = await Bun.build({
    entrypoints: [resolve(root, 'apps', 'api', 'src', 'entry.bun.ts')],
    packages: 'bundle',
    compile: {
      target: compileTarget,
      outfile: output,
      autoloadDotenv: false,
      autoloadPackageJson: true,
      autoloadTsconfig: true,
      autoloadBunfig: true,
      ...(targetPlatform === 'win32' ? { windows: { hideConsole: true } } : {}),
    },
    plugins: [{
      name: 'techspar-text-only-transformers',
      setup(builder) {
        builder.onResolve({ filter: /^sharp$/ }, () => ({ path: sharpStub }))
      },
    }],
  })
} finally {
  const scratchFiles = (await readdir(root)).filter((name) =>
    !filesBeforeBuild.has(name) && buildScratchPattern.test(name))
  await Promise.all(scratchFiles.map((name) => rm(join(root, name), { force: true })))
}
if (!build.success) {
  for (const message of build.logs) console.error(message)
  throw new Error('Desktop backend compilation failed')
}
if (targetPlatform !== 'win32') await chmod(output, 0o755)
const transformers = await realpath(join(root, 'packages', 'providers', 'node_modules', '@huggingface', 'transformers'))
const onnxRuntime = await realpath(join(transformers, '..', '..', 'onnxruntime-node'))
await cp(join(onnxRuntime, 'bin', 'napi-v3', targetPlatform, targetArch), runtimeOutput, { recursive: true, dereference: true })
console.log(`Compiled desktop backend (${targetPlatform}-${targetArch}): ${output}`)
