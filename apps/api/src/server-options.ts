export function withLongRequestTimeout<T extends object>(options: T): T & { idleTimeout: 255 } {
  return { ...options, idleTimeout: 255 }
}
