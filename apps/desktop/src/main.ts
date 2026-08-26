import path from 'node:path'
import { pathToFileURL } from 'node:url'
import squirrelStartup from 'electron-squirrel-startup'
import {
  app,
  autoUpdater,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  session,
  shell,
} from 'electron'
import { updateElectronApp, UpdateSourceType } from 'update-electron-app'
import log from 'electron-log/main'
import type { DesktopCommand, DesktopStoredSession } from './globals'
import { clearStoredSession, loadStoredSession, storeSession } from './session-store'
import {
  DESKTOP_ORIGIN,
  isTrustedRendererUrl,
  rendererAssetPath,
  validatedExternalUrl,
  validatedProtocolUrl,
} from './security'
import { loadWindowState, saveWindowState } from './window-state'
import { DesktopUpdater, type ManualUpdateCheckResult } from './updater'

const WINDOWS_APP_USER_MODEL_ID = 'com.squirrel.Pulpo.Pulpo'

const developmentUrl = typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string'
  ? MAIN_WINDOW_VITE_DEV_SERVER_URL
  : undefined
const rendererOrigin = developmentUrl ? new URL(developmentUrl).origin : DESKTOP_ORIGIN
const pendingProtocolUrls: string[] = []
let mainWindow: BrowserWindow | null = null
let rendererReady = false
let desktopUpdater: DesktopUpdater | null = null

log.initialize({ preload: false })

if (process.platform === 'win32') app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID)

const hasSingleInstanceLock = !squirrelStartup && app.requestSingleInstanceLock()
if (!squirrelStartup && !hasSingleInstanceLock) {
  app.quit()
}

function desktopUpdatesSupported(): boolean {
  return app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32')
}

function sendCommand(command: DesktopCommand): void {
  mainWindow?.webContents.send('desktop:command', command)
}

function applicationMenu(): Menu {
  const updateState = desktopUpdater?.getState()
  const updateReady = updateState?.status === 'ready'
  const updateBusy = updateState?.status === 'checking' || updateState?.status === 'downloading'
  return Menu.buildFromTemplate([
    {
      label: 'Pulpo',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => sendCommand('settings') },
        {
          label: 'Check for Updates…',
          visible: desktopUpdatesSupported(),
          enabled: !updateBusy && !updateReady,
          click: () => desktopUpdater?.checkForUpdates(),
        },
        {
          label: updateReady ? `Restart to Update to v${updateState.version}` : 'Restart to Update',
          visible: updateReady,
          click: () => desktopUpdater?.restartAndInstall(),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Chat', accelerator: 'CmdOrCtrl+N', click: () => sendCommand('new-chat') },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'View',
      submenu: [
        { role: 'reload', visible: !app.isPackaged },
        { role: 'forceReload', visible: !app.isPackaged },
        { role: 'toggleDevTools', visible: !app.isPackaged },
        { type: 'separator', visible: !app.isPackaged },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
  ])
}

function updateApplicationMenu(): void {
  Menu.setApplicationMenu(applicationMenu())
}

function publishUpdateState(): void {
  updateApplicationMenu()
}

function showManualUpdateCheckResult(result: ManualUpdateCheckResult): void {
  const options: Electron.MessageBoxOptions = result === 'up-to-date'
    ? {
        type: 'info',
        title: 'Software Update',
        message: 'Pulpo is up to date.',
        detail: `Pulpo v${app.getVersion()} is currently the newest version available.`,
      }
    : {
        type: 'error',
        title: 'Software Update',
        message: 'Unable to check for updates.',
        detail: 'Check your internet connection and try again.',
      }
  if (mainWindow && !mainWindow.isDestroyed()) void dialog.showMessageBox(mainWindow, options)
  else void dialog.showMessageBox(options)
}

function initializeDesktopUpdater(): void {
  desktopUpdater = new DesktopUpdater({
    enabled: desktopUpdatesSupported(),
    autoUpdater,
    startUpdates: () => updateElectronApp({
      updateSource: {
        type: UpdateSourceType.ElectronPublicUpdateService,
        repo: 'IsaacThoman/pulpo',
      },
      updateInterval: '1 hour',
      logger: log,
      notifyUser: true,
    }),
    onStateChanged: publishUpdateState,
    onManualCheckResult: showManualUpdateCheckResult,
    onError: (error) => log.error('Desktop updater failed', error),
  })
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (!event.senderFrame || !isTrustedRendererUrl(event.senderFrame.url, developmentUrl)) throw new Error('Untrusted renderer.')
}

function trustedWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow {
  assertTrustedSender(event)
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || window !== mainWindow) throw new Error('Untrusted window.')
  return window
}

function validStoredSession(value: unknown): DesktopStoredSession {
  if (!value || typeof value !== 'object') throw new Error('Invalid session.')
  const candidate = value as Partial<DesktopStoredSession>
  if (typeof candidate.instanceUrl !== 'string' || typeof candidate.token !== 'string' || candidate.token.length < 32 || typeof candidate.expiresAt !== 'string') {
    throw new Error('Invalid session.')
  }
  const instance = new URL(candidate.instanceUrl)
  const localhost = ['localhost', '127.0.0.1', '[::1]'].includes(instance.hostname)
  if (instance.username || instance.password || (instance.protocol !== 'https:' && !(developmentUrl && localhost && instance.protocol === 'http:'))) {
    throw new Error('Invalid instance URL.')
  }
  if (!Number.isFinite(Date.parse(candidate.expiresAt))) throw new Error('Invalid session expiry.')
  return { instanceUrl: instance.origin, token: candidate.token, expiresAt: candidate.expiresAt }
}

function registerIpc(): void {
  ipcMain.handle('desktop:session:load', async (event) => {
    assertTrustedSender(event)
    return loadStoredSession()
  })
  ipcMain.handle('desktop:session:store', async (event, value: unknown) => {
    assertTrustedSender(event)
    await storeSession(validStoredSession(value))
  })
  ipcMain.handle('desktop:session:clear', async (event) => {
    assertTrustedSender(event)
    await clearStoredSession()
  })
  ipcMain.handle('desktop:open-external', async (event, value: unknown) => {
    assertTrustedSender(event)
    if (typeof value !== 'string') throw new Error('Invalid URL.')
    await shell.openExternal(validatedExternalUrl(value, !app.isPackaged))
  })
  ipcMain.handle('desktop:app-info', (event) => {
    assertTrustedSender(event)
    return { name: app.getName(), version: app.getVersion(), packaged: app.isPackaged }
  })
  ipcMain.handle('desktop:window:minimize', (event) => {
    trustedWindow(event).minimize()
  })
  ipcMain.handle('desktop:window:toggle-maximize', (event) => {
    const window = trustedWindow(event)
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
    return window.isMaximized()
  })
  ipcMain.handle('desktop:window:close', (event) => {
    trustedWindow(event).close()
  })
  ipcMain.handle('desktop:window:is-maximized', (event) => trustedWindow(event).isMaximized())
}

function deliverProtocolUrl(value: string): void {
  let validated: string
  try {
    validated = validatedProtocolUrl(value)
  } catch {
    return
  }
  if (!mainWindow || !rendererReady) pendingProtocolUrls.push(validated)
  else mainWindow.webContents.send('desktop:protocol-url', validated)
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
}

function registerRendererProtocol(): void {
  if (developmentUrl) return
  const rendererRoot = path.join(app.getAppPath(), `.vite/renderer/${MAIN_WINDOW_VITE_NAME}`)
  protocol.handle('https', async (request) => {
    const url = new URL(request.url)
    if (url.origin !== DESKTOP_ORIGIN) return net.fetch(request, { bypassCustomProtocolHandlers: true })
    const relative = rendererAssetPath(url.pathname)
    if (relative === null) return new Response('Not found', { status: 404 })
    const requested = relative || 'index.html'
    const asset = path.extname(requested) ? requested : 'index.html'
    return net.fetch(pathToFileURL(path.join(rendererRoot, asset)).toString())
  })
}

function configureSession(): void {
  const contentsSession = session.defaultSession
  contentsSession.webRequest.onHeadersReceived((details, callback) => {
    if (developmentUrl || new URL(details.url).origin !== rendererOrigin) return callback({ responseHeaders: details.responseHeaders })
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' https: wss:; worker-src 'self' blob:; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'self' https:",
        ],
      },
    })
  })
  contentsSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const trusted = isTrustedRendererUrl(webContents.getURL(), developmentUrl)
    const audioOnly = permission === 'media'
      && 'mediaTypes' in details
      && (!details.mediaTypes || details.mediaTypes.every((type: string) => type === 'audio'))
    callback(trusted && audioOnly)
  })
  contentsSession.on('will-download', (_event, item, webContents) => {
    if (!isTrustedRendererUrl(webContents.getURL(), developmentUrl)) {
      item.cancel()
      return
    }
    item.pause()
    const saveDialog = mainWindow
      ? dialog.showSaveDialog(mainWindow, { defaultPath: item.getFilename() })
      : dialog.showSaveDialog({ defaultPath: item.getFilename() })
    void saveDialog.then(({ canceled, filePath }) => {
      if (canceled || !filePath) item.cancel()
      else {
        item.setSavePath(filePath)
        item.resume()
      }
    })
  })
}

async function createMainWindow(): Promise<void> {
  const state = await loadWindowState()
  const preload = path.join(__dirname, 'preload.js')
  const window = new BrowserWindow({
    ...state,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'Pulpo',
    ...(process.platform === 'win32'
      ? { frame: false }
      : process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } }
        : {}),
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  })
  mainWindow = window
  if (state.maximized) window.maximize()
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(validatedExternalUrl(url, !app.isPackaged)).catch(() => undefined)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== rendererOrigin) {
      event.preventDefault()
      void shell.openExternal(validatedExternalUrl(url, !app.isPackaged)).catch(() => undefined)
    }
  })
  window.webContents.on('did-finish-load', () => {
    rendererReady = true
    for (const url of pendingProtocolUrls.splice(0)) window.webContents.send('desktop:protocol-url', url)
  })
  window.webContents.on('did-start-loading', () => { rendererReady = false })
  window.once('ready-to-show', () => window.show())
  window.on('close', () => { void saveWindowState(window) })
  const publishMaximizedState = () => window.webContents.send('desktop:window:maximized-changed', window.isMaximized())
  window.on('maximize', publishMaximizedState)
  window.on('unmaximize', publishMaximizedState)
  window.on('closed', () => {
    rendererReady = false
    if (mainWindow === window) mainWindow = null
  })
  await window.loadURL(developmentUrl ?? DESKTOP_ORIGIN)
}

if (hasSingleInstanceLock) {
  app.on('open-url', (event, url) => {
    event.preventDefault()
    deliverProtocolUrl(url)
  })

  app.on('second-instance', (_event, argv) => {
    const callback = argv.find((value) => value.startsWith('pulpo://'))
    if (callback) deliverProtocolUrl(callback)
    else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    app.setName('Pulpo')
    if (process.defaultApp && process.argv[1]) {
      app.setAsDefaultProtocolClient('pulpo', process.execPath, [path.resolve(process.argv[1])])
    } else {
      app.setAsDefaultProtocolClient('pulpo')
    }
    registerRendererProtocol()
    configureSession()
    initializeDesktopUpdater()
    registerIpc()
    updateApplicationMenu()
    await createMainWindow()
    desktopUpdater?.start()
    const initialCallback = process.argv.find((value) => value.startsWith('pulpo://'))
    if (initialCallback) deliverProtocolUrl(initialCallback)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createMainWindow()
    })
  }).catch((error) => {
    dialog.showErrorBox('Pulpo could not start', error instanceof Error ? error.message : String(error))
    app.quit()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
