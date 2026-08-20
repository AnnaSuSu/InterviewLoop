import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

export type BackendLaunch = {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
}

export type BackendReady = { origin: string; port: number }

type ReadyMessage = { event?: string; host?: string; port?: number }

export class BackendSupervisor {
  private child?: ReturnType<typeof spawn>
  private stopping = false
  private ready = false

  constructor(
    private readonly launch: BackendLaunch,
    private readonly onUnexpectedExit?: (message: string) => void,
  ) {}

  async start(timeoutMs = 45_000): Promise<BackendReady> {
    if (this.child) throw new Error('Backend process already started')
    const child = spawn(this.launch.command, this.launch.args, { cwd: this.launch.cwd, env: this.launch.env, stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child
    let stderr = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-8_000) })
    const lines = createInterface({ input: child.stdout! })

    return new Promise<BackendReady>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error, result?: BackendReady) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error); else resolve(result!)
      }
      const timer = setTimeout(() => {
        void this.stop()
        finish(new Error(`TechSpar backend did not become ready within ${timeoutMs} ms${stderr ? `\n${stderr}` : ''}`))
      }, timeoutMs)
      lines.on('line', (line) => {
        let message: ReadyMessage
        try { message = JSON.parse(line) as ReadyMessage } catch { return }
        if (message.event !== 'techspar:ready' || !Number.isInteger(message.port) || Number(message.port) <= 0) return
        this.ready = true
        const host = !message.host || message.host === '0.0.0.0' || message.host === '::' ? '127.0.0.1' : message.host
        finish(undefined, { origin: `http://${host}:${message.port}`, port: Number(message.port) })
      })
      child.once('error', (error) => finish(error))
      child.once('exit', (code, signal) => {
        const detail = `TechSpar backend exited (${signal || (code ?? 'unknown')})${stderr ? `\n${stderr}` : ''}`
        if (!this.ready) finish(new Error(detail))
        else if (!this.stopping) this.onUnexpectedExit?.(detail)
      })
    })
  }

  async stop(graceMs = 3_000): Promise<void> {
    const child = this.child
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    this.stopping = true
    child.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, graceMs)
      child.once('exit', () => { clearTimeout(timer); resolve() })
    })
  }
}
