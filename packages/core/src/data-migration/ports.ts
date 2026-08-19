import type { UserRepository } from '../account/ports.ts'
import type { RequestContext } from '../kernel/context.ts'
import type { CandidateProfileRepository } from '../profile/ports.ts'

export const DATA_ARCHIVE_SCHEMA_VERSION = 2
export const MAX_ARCHIVE_UPLOAD_BYTES = 500 * 1024 * 1024

export type ArchiveManifest = {
  schema_version: number
  exported_at: string
  user_id: string | null
  backup_kind: 'personal' | 'system'
  includes_sensitive_credentials: boolean
  source?: string
}
export type ArchiveContents = { manifest?: ArchiveManifest; database?: Uint8Array; files: Map<string, Uint8Array> }

export interface DataArchiveCodec {
  pack(contents: { manifest: ArchiveManifest; database?: Uint8Array; files: Map<string, Uint8Array> }): Promise<Uint8Array>
  unpack(bytes: Uint8Array): Promise<ArchiveContents>
}

export interface MigrationDatabase {
  exportPersonal(userId: string): Promise<Uint8Array | undefined>
  exportSystem(): Promise<Uint8Array | undefined>
  importPersonal(bytes: Uint8Array, userId: string, strategy: 'skip' | 'overwrite'): Promise<{ inserted: number; skipped: number }>
  rebuiltStats(userId: string): Promise<Record<string, unknown>>
  invalidateDerivedData(userId: string): Promise<void>
}

export interface MigrationFileStore {
  exportPersonal(userId: string, includeSensitive: boolean): Promise<Map<string, Uint8Array>>
  exportSystem(): Promise<Map<string, Uint8Array>>
  exists(userId: string, relativePath: string): Promise<boolean>
  write(userId: string, relativePath: string, bytes: Uint8Array): Promise<void>
}

export interface DataMigrationUseCases {
  exportSystem(context: RequestContext): Promise<{ filename: string; bytes: Uint8Array }>
  exportPersonal(context: RequestContext, includeSensitive: boolean): Promise<{ filename: string; bytes: Uint8Array }>
  importPersonal(context: RequestContext, filename: string, bytes: Uint8Array, options: { dbStrategy: 'skip' | 'overwrite'; overwriteFiles: boolean }): Promise<Record<string, unknown>>
}

export type DataMigrationDependencies = {
  codec: DataArchiveCodec
  database: MigrationDatabase
  files: MigrationFileStore
  profiles: CandidateProfileRepository
  users: UserRepository
}
