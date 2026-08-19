import type { RequestContext } from '../kernel/context.ts'
import type { VoiceprintConfig, VoiceprintCredentials, VoiceprintStatus } from './model.ts'

export interface VoiceprintRepository { load(userId: string): Promise<VoiceprintConfig>; save(userId: string, value: VoiceprintConfig): Promise<void> }
export interface VoiceprintDriver {
  ping(): Promise<boolean>
  enroll(speakerNick: string, pcmBytes: Uint8Array): Promise<string | undefined>
  verify(voicePrintId: string, pcmBytes: Uint8Array): Promise<{ matched: boolean; score: number } | undefined>
  delete(voicePrintId: string): Promise<boolean>
}
export interface VoiceprintDriverFactory { create(credentials: VoiceprintCredentials): VoiceprintDriver }
export interface VoiceRoleDetector { verify(pcmBytes: Uint8Array): Promise<'candidate' | 'hr' | undefined> }
export interface VoiceRoleDetectionUseCases { detector(context: RequestContext): Promise<VoiceRoleDetector | undefined> }
export interface VoiceprintUseCases extends VoiceRoleDetectionUseCases {
  status(context: RequestContext): Promise<VoiceprintStatus>
  credentials(context: RequestContext, value: VoiceprintCredentials): Promise<{ ok: true }>
  enroll(context: RequestContext, wavBytes: Uint8Array): Promise<{ ok: true; enrolled_at: string }>
  unenroll(context: RequestContext): Promise<{ ok: true }>
}
