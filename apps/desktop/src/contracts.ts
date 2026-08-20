export type DesktopRuntimeInfo = {
  appVersion: string
  platform: NodeJS.Platform
  arch: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
}

export const DESKTOP_RUNTIME_CHANNEL = 'techspar:runtime-info'

export type DesktopBootstrapSession = {
  token: string
  user: { id: string; email: string; name: string; is_admin: boolean }
}

export const DESKTOP_BOOTSTRAP_CHANNEL = 'techspar:bootstrap-session'
