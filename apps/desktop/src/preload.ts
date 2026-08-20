import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_RUNTIME_CHANNEL, type DesktopRuntimeInfo } from './contracts.ts'

contextBridge.exposeInMainWorld('techsparDesktop', {
  getRuntimeInfo: (): Promise<DesktopRuntimeInfo> => ipcRenderer.invoke(DESKTOP_RUNTIME_CHANNEL),
})
