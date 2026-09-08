import { app, dialog, safeStorage, utilityProcess, type UtilityProcess } from 'electron'
import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
declare const PULPO_DEVELOPMENT_RG_PATH: string
import { loadStoredSession } from './session-store'
import type { ComputerRegistration } from '@pulpo/contracts'

interface HostConfig { id: string; token: string; instanceUrl: string; registration: ComputerRegistration }
let config: HostConfig | undefined
let child: UtilityProcess | undefined
let online = false
let stopping = false
let changed = () => {}
const filename = () => path.join(app.getPath('userData'), 'workspace-host.json')
export const hostStatus = () => ({ enabled: !!config, online, name: config?.registration.name, folder: config?.registration.roots[0]?.path })
export function onHostChanged(callback: () => void) { changed = callback }
async function request(url: string, token: string, method: string, body?: unknown) {
  const response = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`Workspace registration failed (${response.status})`)
  return response.json()
}
function launch() {
  if (!config || child || stopping) return
  child = utilityProcess.fork(path.join(__dirname, 'workspace-host-worker.js'), [], { serviceName: 'Pulpo workspace', stdio: 'pipe' })
  child.on('message', message => {
    if (message?.revoked) { void disableHosting(); return }
    online = !!message?.online; changed()
  })
  child.on('exit', () => { child = undefined; online = false; changed(); if (config && !stopping) setTimeout(launch, 1000) })
  child.postMessage({ type: 'start', instanceUrl: config.instanceUrl, token: config.token, config: {
    journal: path.join(app.getPath('userData'), 'workspace-operations', config.id), roots: config.registration.roots,
    shell: config.registration.shell, stagingPath: config.registration.stagingPath, rgPath: app.isPackaged ? path.join(process.resourcesPath, process.platform === 'win32' ? 'rg.exe' : 'rg') : PULPO_DEVELOPMENT_RG_PATH,
  } })
}
export async function restoreHosting() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return
    const encrypted = await readFile(filename())
    const stored = JSON.parse((await safeStorage.decryptStringAsync(encrypted)).result) as HostConfig
    const session = await loadStoredSession()
    if (!session || session.instanceUrl !== stored.instanceUrl) { await rm(filename(), { force: true }); return }
    config = stored; launch(); changed()
  } catch { /* Hosting is opt-in; a missing credential leaves it disabled. */ }
}
export async function enableHosting() {
  if (config) return hostStatus()
  if (process.platform !== 'darwin' && process.platform !== 'win32') throw new Error('Computer hosting supports macOS and Windows')
  const session = await loadStoredSession()
  if (!session || !safeStorage.isEncryptionAvailable()) throw new Error('Sign in with secure credential storage before enabling hosting')
  const choice = await dialog.showMessageBox({ type: 'question', title: 'Use this computer as a workspace?', message: 'Pulpo can run commands and access files with your OS user’s permissions.', detail: 'The working folder is not a sandbox. Commands may access other files available to your account. Hosting stays active in the tray when you close the window. Quit Pulpo or disable hosting to take this computer offline.', buttons: ['Enable hosting', 'Cancel'], defaultId: 1, cancelId: 1 })
  if (choice.response !== 0) return hostStatus()
  const defaultPath = path.join(app.getPath('documents'), 'Pulpo'); await mkdir(defaultPath, { recursive: true })
  const folder = await dialog.showOpenDialog({ title: 'Workspace working folder', defaultPath, properties: ['openDirectory', 'createDirectory'] })
  if (folder.canceled || !folder.filePaths[0]) return hostStatus()
  const registration: ComputerRegistration = { supportedTools: ['bash', 'read', 'write', 'edit', 'list', 'find', 'grep', 'stat', 'import', 'export'], name: hostname(), platform: process.platform, stagingPath: path.join(app.getPath('userData'), 'workspace-files'), shell: process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/zsh', roots: [{ id: randomUUID(), path: folder.filePaths[0] }] }
  const registered = await request(`${session.instanceUrl}/api/me/computers`, session.token, 'POST', registration) as { id: string; token: string }
  const next = { ...registered, instanceUrl: session.instanceUrl, registration }
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(next))
  await writeFile(`${filename()}.tmp`, encrypted, { mode: 0o600 }); await rename(`${filename()}.tmp`, filename())
  config = next; stopping = false; launch(); changed(); return hostStatus()
}
export function stopHosting() { stopping = true; child?.postMessage({ type: 'stop' }); online = false; changed() }
export async function disableHosting() {
  const old = config; config = undefined; stopHosting()
  await rm(filename(), { force: true })
  const session = await loadStoredSession()
  if (old && session?.instanceUrl === old.instanceUrl) await request(`${old.instanceUrl}/api/me/computers/${old.id}`, session.token, 'DELETE').catch(() => undefined)
  return hostStatus()
}
