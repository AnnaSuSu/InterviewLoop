import { createRoute, type OpenAPIHono } from '@hono/zod-openapi'
import { BinarySchema, DataImportSchema, PersonalAgentObjectSchema } from '@techspar/contracts'
import type { DataMigrationUseCases, TokenService } from '@techspar/core'
import { authenticatedContext } from '../http/context.ts'

function archiveResponse(value: { filename: string; bytes: Uint8Array }): Response {
  return new Response(value.bytes as unknown as BodyInit, { headers: { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${value.filename}"` } })
}

export function registerDataMigrationRoutes(app: OpenAPIHono, deps: { migration: DataMigrationUseCases; tokens: TokenService }): void {
  app.openapi(createRoute({ method: 'get', path: '/api/data/export', responses: { 200: { content: { 'application/gzip': { schema: BinarySchema } }, description: 'System backup' } } }),
    async (c) => archiveResponse(await deps.migration.exportSystem(await authenticatedContext(c, deps.tokens))))

  app.openapi(createRoute({ method: 'get', path: '/api/data/export/personal', request: { query: DataImportSchema.pick({}).extend({ include_sensitive: DataImportSchema.shape.overwrite_files.optional() }) }, responses: { 200: { content: { 'application/gzip': { schema: BinarySchema } }, description: 'Personal backup' } } }),
    async (c) => archiveResponse(await deps.migration.exportPersonal(await authenticatedContext(c, deps.tokens), Boolean(c.req.valid('query').include_sensitive))))

  app.openapi(createRoute({ method: 'post', path: '/api/data/import', request: { body: { content: { 'multipart/form-data': { schema: DataImportSchema } } } }, responses: { 200: { content: { 'application/json': { schema: PersonalAgentObjectSchema } }, description: 'Import personal backup' } } }),
    async (c) => {
      const body = c.req.valid('form')
      return c.json(await deps.migration.importPersonal(await authenticatedContext(c, deps.tokens), body.file.name || 'upload', new Uint8Array(await body.file.arrayBuffer()), { dbStrategy: body.db_strategy, overwriteFiles: body.overwrite_files }))
    })
}
