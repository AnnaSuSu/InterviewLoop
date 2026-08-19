export function createTestSignal(): AbortSignal {
  return new AbortController().signal
}
