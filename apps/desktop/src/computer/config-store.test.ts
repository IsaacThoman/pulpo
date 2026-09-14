import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { COMPUTER_CONFIG_FILE, defaultComputerConfig, loadComputerConfig, normalizeComputerConfig, saveComputerConfig } from './config-store'

describe('computer config store', () => {
  let directory = ''
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'pulpo-computer-config-')) })
  afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

  it('starts disabled in folder mode with a fresh id and the hostname as its name', () => {
    const config = defaultComputerConfig('studio.local')
    expect(config).toMatchObject({ enabled: false, accessMode: 'folder', rootPath: null, approvalPolicy: 'default', allowRemote: false, name: 'studio.local' })
    expect(config.computerId).toMatch(/^[0-9a-f-]{36}$/)
    expect(defaultComputerConfig('other').computerId).not.toBe(config.computerId)
  })

  it('keeps a stored id across loads and round-trips settings', async () => {
    const saved = { ...defaultComputerConfig('studio'), enabled: true, rootPath: '/Users/me/projects', approvalPolicy: 'bash-only' as const, allowRemote: true }
    await saveComputerConfig(directory, saved)
    const loaded = await loadComputerConfig(directory, 'studio')
    expect(loaded).toEqual(saved)
    expect(JSON.parse(await readFile(join(directory, COMPUTER_CONFIG_FILE), 'utf8')).computerId).toBe(saved.computerId)
  })

  it('never enables folder mode without a folder and rejects junk values', () => {
    const config = normalizeComputerConfig({ computerId: 'not-a-uuid', enabled: true, accessMode: 'folder', rootPath: '', approvalPolicy: 'sometimes', allowRemote: 'yes', name: '' }, 'host')
    expect(config.enabled).toBe(false)
    expect(config.computerId).toMatch(/^[0-9a-f-]{36}$/)
    expect(config.approvalPolicy).toBe('default')
    expect(config.allowRemote).toBe(false)
    expect(config.name).toBe('host')
  })

  it('allows full mode to be enabled without a folder', () => {
    const config = normalizeComputerConfig({ ...defaultComputerConfig('host'), enabled: true, accessMode: 'full' }, 'host')
    expect(config.enabled).toBe(true)
  })

  it('falls back to defaults when the file is corrupt', async () => {
    await writeFile(join(directory, COMPUTER_CONFIG_FILE), '{not json')
    const loaded = await loadComputerConfig(directory, 'host')
    expect(loaded.enabled).toBe(false)
  })
  it('persists a device secret and never replaces it when normalizing settings', async () => {
    const config = defaultComputerConfig('studio')
    expect(config.deviceSecret).toMatch(/^[a-f0-9]{64}$/)
    await saveComputerConfig(directory, config)
    expect((await loadComputerConfig(directory, 'studio')).deviceSecret).toBe(config.deviceSecret)
    expect(normalizeComputerConfig({ ...config, name: 'renamed' }, 'studio').deviceSecret).toBe(config.deviceSecret)
  })

})
