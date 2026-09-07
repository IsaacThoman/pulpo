import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ userData: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => electron.userData },
  screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] },
}))

import { loadWindowState, saveWindowState } from './window-state'
import type { BrowserWindow } from 'electron'

describe('desktop window size persistence', () => {
  beforeEach(async () => {
    electron.userData = await mkdtemp(path.join(os.tmpdir(), 'pulpo-window-'))
  })
  afterEach(async () => {
    await rm(electron.userData, { recursive: true, force: true })
  })

  it.each([500, 640, 749, 800])('restores a saved %ipx window', async (width) => {
    const bounds = { width, height: 600, x: 100, y: 100 }
    await saveWindowState({
      isDestroyed: () => false,
      isMaximized: () => false,
      getBounds: () => bounds,
    } as BrowserWindow)
    await expect(loadWindowState()).resolves.toEqual({ ...bounds, maximized: false })
  })

  it.each([
    { width: 499, height: 600 },
    { width: 500, height: 599 },
    { width: 500, height: 600, x: 3000, y: 0 },
  ])('rejects unusable bounds %j', async (bounds) => {
    await writeFile(path.join(electron.userData, 'window-state.json'), JSON.stringify(bounds))
    await expect(loadWindowState()).resolves.toEqual({ width: 1280, height: 820 })
  })
})
