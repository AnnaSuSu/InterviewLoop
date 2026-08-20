import { createServer } from 'node:net'

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function command(args: string[]): Promise<void> {
  const child = Bun.spawn(args, { cwd: process.cwd(), stdout: 'inherit', stderr: 'inherit', env: process.env })
  const code = await child.exited
  if (code !== 0) throw new Error(`${args.join(' ')} failed with exit code ${code}`)
}

await command(['bun', 'run', '--cwd', 'apps/desktop', 'build'])
const apiPort = await freePort()
const rendererPort = await freePort()
const rendererUrl = `http://127.0.0.1:${rendererPort}`
const environment = {
  ...process.env,
  TECHSPAR_API_TARGET: `http://127.0.0.1:${apiPort}`,
  TECHSPAR_BUN_EXECUTABLE: process.execPath,
  TECHSPAR_DESKTOP_API_PORT: String(apiPort),
  TECHSPAR_PROJECT_ROOT: process.cwd(),
  TECHSPAR_RENDERER_URL: rendererUrl,
}
const renderer = Bun.spawn(['bun', 'run', '--cwd', 'frontend', 'dev', '--host', '127.0.0.1', '--port', String(rendererPort), '--strictPort'], { cwd: process.cwd(), stdout: 'inherit', stderr: 'inherit', env: environment })

try {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(rendererUrl)).ok) break } catch {}
    if (attempt === 99) throw new Error('Vite renderer did not become ready')
    await Bun.sleep(100)
  }
  const electron = Bun.spawn(['bun', 'run', '--cwd', 'apps/desktop', 'start'], { cwd: process.cwd(), stdout: 'inherit', stderr: 'inherit', env: environment })
  const stop = () => electron.kill()
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  const code = await electron.exited
  if (code !== 0) process.exitCode = code
} finally {
  renderer.kill()
  await renderer.exited
}
