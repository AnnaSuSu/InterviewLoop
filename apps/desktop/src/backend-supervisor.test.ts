import { describe, expect, test } from 'bun:test'
import { BackendSupervisor } from './backend-supervisor.ts'

describe('desktop backend supervisor', () => {
  test('waits for the structured readiness event and stops the sidecar', async () => {
    const supervisor = new BackendSupervisor({
      command: process.execPath,
      args: ['-e', "console.log(JSON.stringify({event:'techspar:ready',host:'127.0.0.1',port:32123})); setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
      env: process.env,
    })
    expect(await supervisor.start(3_000)).toEqual({ origin: 'http://127.0.0.1:32123', port: 32123 })
    await supervisor.stop(1_000)
  })

  test('surfaces startup stderr when the sidecar exits early', async () => {
    const supervisor = new BackendSupervisor({
      command: process.execPath,
      args: ['-e', "console.error('boot failed'); process.exit(7)"],
      cwd: process.cwd(),
      env: process.env,
    })
    await expect(supervisor.start(3_000)).rejects.toThrow('boot failed')
  })
})
