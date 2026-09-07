import { expect, test } from 'bun:test'
import { withLongRequestTimeout } from './server-options.ts'

test('configures Bun for long-running model requests', () => {
  const options = withLongRequestTimeout({ hostname: '127.0.0.1', port: 0 })
  expect(options).toMatchObject({ idleTimeout: 255 })
})
