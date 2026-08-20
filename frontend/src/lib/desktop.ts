export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && Boolean(window.techsparDesktop)
}

export async function getDesktopRuntimeInfo(): Promise<TechSparDesktopRuntimeInfo | undefined> {
  return window.techsparDesktop?.getRuntimeInfo()
}

export async function bootstrapDesktopSession(): Promise<TechSparDesktopBootstrapSession | undefined> {
  return window.techsparDesktop?.bootstrapSession()
}
