export type DesktopRuntimeInfo = {
  appVersion: string
  platform: NodeJS.Platform
  arch: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
}

export const DESKTOP_RUNTIME_CHANNEL = 'techspar:runtime-info'
