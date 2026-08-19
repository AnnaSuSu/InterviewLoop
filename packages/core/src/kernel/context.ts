export type RequestContext = {
  requestId: string
  userId?: string
  signal: AbortSignal
}
