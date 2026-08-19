export type VoiceprintCredentials = { secret_id: string; secret_key: string; app_id: string }
export type VoiceprintEnrollment = { voice_print_id: string; speaker_nick: string; enrolled_at: string }
export type VoiceprintConfig = { credentials?: VoiceprintCredentials; enrollment?: VoiceprintEnrollment }
export type VoiceprintStatus = { configured: boolean; enrolled: boolean; enrolled_at?: string | null; speaker_nick?: string | null }
