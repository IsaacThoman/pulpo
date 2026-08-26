import { contextBridge, ipcRenderer } from 'electron'
import type {
  DesktopCommand,
  DesktopOperatingSystem,
  DesktopStoredSession,
  DesktopUpdateState,
  PulpoDesktopApi,
} from './globals'

function operatingSystem(): DesktopOperatingSystem {
  if (process.platform === 'darwin' || process.platform === 'win32') return process.platform
  return 'linux'
}

const api: PulpoDesktopApi = {
  platform: 'desktop',
  os: operatingSystem(),
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
  windowControls: {
    minimize: () => ipcRenderer.invoke('desktop:window:minimize') as Promise<void>,
    toggleMaximize: () => ipcRenderer.invoke('desktop:window:toggle-maximize') as Promise<boolean>,
    close: () => ipcRenderer.invoke('desktop:window:close') as Promise<void>,
    isMaximized: () => ipcRenderer.invoke('desktop:window:is-maximized') as Promise<boolean>,
    onMaximizedChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) => listener(maximized)
      ipcRenderer.on('desktop:window:maximized-changed', handler)
      return () => ipcRenderer.removeListener('desktop:window:maximized-changed', handler)
    },
  },
  updates: {
    getState: () => ipcRenderer.invoke('desktop:update-state') as Promise<DesktopUpdateState>,
    onStateChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: DesktopUpdateState) => listener(state)
      ipcRenderer.on('desktop:update-state-changed', handler)
      return () => ipcRenderer.removeListener('desktop:update-state-changed', handler)
    },
    restartAndInstall: () => ipcRenderer.invoke('desktop:update-restart') as Promise<void>,
  },
}

contextBridge.exposeInMainWorld('pulpoDesktop', api)
