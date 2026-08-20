import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import type { OpenAPIHono } from '@hono/zod-openapi'

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' https: wss:; worker-src 'self' blob:",
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self)',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
}

function safeFile(root: string, requestPath: string): string | undefined {
  let decoded: string
  try { decoded = decodeURIComponent(requestPath) } catch { return undefined }
  if (decoded.includes('\\') || decoded.split('/').some((part) => part === '..')) return undefined
  const base = resolve(root)
  const path = resolve(base, `.${decoded}`)
  return path === base || path.startsWith(`${base}${sep}`) ? path : undefined
}

async function regularFile(path: string): Promise<boolean> {
  try { return (await stat(path)).isFile() } catch { return false }
}

export function registerStaticFrontend(app: OpenAPIHono, webDir: string): void {
  const index = resolve(webDir, 'index.html')
  app.get('*', async (c) => {
    const path = c.req.path
    if (path === '/openapi.json' || path.startsWith('/api/') || path.startsWith('/ws/')) return c.notFound()
    const candidate = safeFile(webDir, path)
    if (!candidate) return c.notFound()
    const file = await regularFile(candidate) ? candidate : extname(path) ? undefined : index
    if (!file || !await regularFile(file)) return c.notFound()
    const bytes = new Uint8Array(await readFile(file))
    const headers = new Headers(SECURITY_HEADERS)
    headers.set('Content-Type', MIME_TYPES[extname(file).toLowerCase()] || 'application/octet-stream')
    headers.set('Cache-Control', path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache')
    return new Response(bytes, { status: 200, headers })
  })
}
