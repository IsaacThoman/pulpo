import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({ userData: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => electron.userData },
  screen: {
    getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
  },
}))

import { loadWindowState, MINIMUM_WINDOW_WIDTH } from './window-state'

describe('desktop window state', () => {
  beforeEach(async () => {
    electron.userData = await mkdtemp(path.join(os.tmpdir(), 'pulpo-window-state-'))
  })

  afterEach(async () => {
    await rm(electron.userData, { recursive: true, force: true })
  })

  it('restores a window at the minimum supported width', async () => {
    const state = { width: MINIMUM_WINDOW_WIDTH, height: 600, x: 20, y: 20 }
    await writeFile(path.join(electron.userData, 'window-state.json'), JSON.stringify(state))

    await expect(loadWindowState()).resolves.toEqual(state)
  })

  it('falls back to the default state below the minimum supported width', async () => {
    await writeFile(path.join(electron.userData, 'window-state.json'), JSON.stringify({
      width: MINIMUM_WINDOW_WIDTH - 1,
      height: 600,
      x: 20,
      y: 20,
    }))

    await expect(loadWindowState()).resolves.toEqual({ width: 1280, height: 820 })
  })
})
