type TechSparDesktopRuntimeInfo = {
  appVersion: string
  platform: string
  arch: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
}

interface Window {
  techsparDesktop?: {
    getRuntimeInfo(): Promise<TechSparDesktopRuntimeInfo>
  }
}
