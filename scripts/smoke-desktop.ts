import { createServer } from 'node:net'

const port = await new Promise<number>((resolve, reject) => {
  const server = createServer()
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    server.close((error) => error ? reject(error) : resolve(typeof address === 'object' && address ? address.port : 0))
  })
})
const child = Bun.spawn(['bun', 'run', '--cwd', 'apps/desktop', 'start', '--', '--smoke-test'], {
  cwd: process.cwd(), stdout: 'inherit', stderr: 'inherit', env: {
    ...process.env,
    TECHSPAR_BUN_EXECUTABLE: process.execPath,
    TECHSPAR_DESKTOP_API_PORT: String(port),
    TECHSPAR_PROJECT_ROOT: process.cwd(),
  },
})
process.exitCode = await child.exited
