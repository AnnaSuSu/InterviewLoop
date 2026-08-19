export type RecordingMode = 'dual' | 'solo'

export type RecordingAnalyzeInput = {
  transcript: string
  recording_mode?: RecordingMode
  company?: string | null
  position?: string | null
}
