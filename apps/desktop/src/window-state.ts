import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, screen } from 'electron'

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
}

const DEFAULT_STATE: WindowState = { width: 1280, height: 820 }
export const MINIMUM_WINDOW_WIDTH = 400

function statePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function isVisible(state: WindowState): boolean {
  if (state.x === undefined || state.y === undefined) return true
  return screen.getAllDisplays().some(({ workArea }) => (
    state.x! < workArea.x + workArea.width - 80
    && state.x! + state.width > workArea.x + 80
    && state.y! < workArea.y + workArea.height - 80
    && state.y! + state.height > workArea.y + 80
  ))
}

export async function loadWindowState(): Promise<WindowState> {
  try {
    const parsed = JSON.parse(await readFile(statePath(), 'utf8')) as WindowState
    if (parsed.width < MINIMUM_WINDOW_WIDTH || parsed.height < 600 || !isVisible(parsed)) return DEFAULT_STATE
    return parsed
  } catch {
    return DEFAULT_STATE
  }
}

export async function saveWindowState(window: BrowserWindow): Promise<void> {
  if (window.isDestroyed()) return
  const bounds = window.isMaximized() ? window.getNormalBounds() : window.getBounds()
  await writeFile(statePath(), `${JSON.stringify({ ...bounds, maximized: window.isMaximized() })}\n`).catch(() => undefined)
}
