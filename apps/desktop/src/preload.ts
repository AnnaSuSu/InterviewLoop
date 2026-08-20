import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_BOOTSTRAP_CHANNEL, DESKTOP_RUNTIME_CHANNEL, type DesktopBootstrapSession, type DesktopRuntimeInfo } from './contracts.ts'

contextBridge.exposeInMainWorld('techsparDesktop', {
  getRuntimeInfo: (): Promise<DesktopRuntimeInfo> => ipcRenderer.invoke(DESKTOP_RUNTIME_CHANNEL),
  bootstrapSession: (): Promise<DesktopBootstrapSession> => ipcRenderer.invoke(DESKTOP_BOOTSTRAP_CHANNEL),
})
