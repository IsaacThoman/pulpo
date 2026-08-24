import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopCommand, DesktopStoredSession, PulpoDesktopApi } from './globals'

const api: PulpoDesktopApi = {
  platform: 'desktop',
  session: {
    load: () => ipcRenderer.invoke('desktop:session:load') as Promise<DesktopStoredSession | null>,
    store: (session) => ipcRenderer.invoke('desktop:session:store', session) as Promise<void>,
    clear: () => ipcRenderer.invoke('desktop:session:clear') as Promise<void>,
  },
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url) as Promise<void>,
  onProtocolUrl: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, url: string) => listener(url)
    ipcRenderer.on('desktop:protocol-url', handler)
    return () => ipcRenderer.removeListener('desktop:protocol-url', handler)
  },
  onCommand: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, command: DesktopCommand) => listener(command)
    ipcRenderer.on('desktop:command', handler)
    return () => ipcRenderer.removeListener('desktop:command', handler)
  },
  appInfo: () => ipcRenderer.invoke('desktop:app-info') as Promise<{ name: string; version: string; packaged: boolean }>,
}

contextBridge.exposeInMainWorld('pulpoDesktop', api)
