import type { RequestContext } from '../kernel/context.ts'
import type { TextGenerationUseCases } from '../provider/ports.ts'

export type ResumeStatus = { has_resume: false } | { has_resume: true; filename: string; size: number }
export type ResumeFile = { filename: string; bytes: Uint8Array }

export interface ResumeStore {
  status(userId: string): Promise<ResumeStatus>
  read(userId: string): Promise<ResumeFile | undefined>
  replace(userId: string, filename: string, bytes: Uint8Array): Promise<void>
  delete(userId: string): Promise<boolean>
}

export interface ResumeTextExtractor {
  extract(filename: string, bytes: Uint8Array): Promise<string>
}

export interface ResumeIndexControl {
  invalidate(userId: string): Promise<void>
}

export interface ShortTranscriptionUseCases {
  transcribe(context: RequestContext, bytes: Uint8Array, suffix: string): Promise<string>
}

export interface ResumeUseCases {
  status(context: RequestContext): Promise<ResumeStatus>
  file(context: RequestContext): Promise<ResumeFile>
  upload(context: RequestContext, filename: string, bytes: Uint8Array): Promise<{ ok: true; filename: string; size: number }>
  delete(context: RequestContext): Promise<{ ok: true }>
  text(context: RequestContext): Promise<string>
  parse(context: RequestContext): Promise<{ ok: true; parsed: Record<string, unknown> }>
  transcribe(context: RequestContext, filename: string, bytes: Uint8Array): Promise<{ text: string }>
}

export type ResumeDependencies = {
  store: ResumeStore
  extractor: ResumeTextExtractor
  index: ResumeIndexControl
  ai: TextGenerationUseCases
  transcription: ShortTranscriptionUseCases
}
