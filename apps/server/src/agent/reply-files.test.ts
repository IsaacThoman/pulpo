import { describe, expect, it } from 'vitest'
import type { ComputerDescription } from '@pulpo/contracts'
import { replyFilesAccess } from './reply-files.js'

const mac: ComputerDescription = {
  os: 'macos', osVersion: 'macOS 15.1', arch: 'arm64', shell: 'zsh', home: '/Users/ada',
  cwd: '/Users/ada/Pulpo', attachmentsDir: '/Users/ada/Pulpo/.pulpo/attachments', filesDir: '/Users/ada/Pulpo/.pulpo/files',
}
const windows: ComputerDescription = {
  os: 'windows', osVersion: 'Windows 11 (10.0.26100)', arch: 'x64', shell: 'pwsh', home: 'C:\\Users\\Ada',
  cwd: 'C:\\Users\\Ada\\Pulpo', attachmentsDir: 'C:\\Users\\Ada\\Pulpo\\.pulpo\\attachments', filesDir: 'C:\\Users\\Ada\\Pulpo\\.pulpo\\files',
}
const cloud = { filesEnabled: true, adminChat: false, temporary: false }

describe('replyFilesAccess', () => {
  it('keeps the cloud rules, with the default mirror', () => {
    expect(replyFilesAccess(cloud)).toEqual({ allowed: true })
    expect(replyFilesAccess({ ...cloud, filesEnabled: false })).toEqual({ allowed: false })
    expect(replyFilesAccess({ ...cloud, adminChat: true })).toEqual({ allowed: false })
    expect(replyFilesAccess({ ...cloud, temporary: true })).toEqual({ allowed: false })
  })

  it('offers Files on a computer only when its app can run pulpo files, in its own folder and shell', () => {
    expect(replyFilesAccess({ ...cloud, computer: { description: mac } })).toEqual({
      allowed: true, mirror: { dir: '/Users/ada/Pulpo/.pulpo/files', separator: '/', shell: 'bash' },
    })
    expect(replyFilesAccess({ ...cloud, computer: { description: windows } })).toEqual({
      allowed: true, mirror: { dir: 'C:\\Users\\Ada\\Pulpo\\.pulpo\\files', separator: '\\', shell: 'powershell' },
    })
    const { filesDir: _, ...older } = mac
    expect(replyFilesAccess({ ...cloud, computer: { description: older } })).toEqual({ allowed: false })
    expect(replyFilesAccess({ ...cloud, computer: { description: undefined } })).toEqual({ allowed: false })
    // The cloud rules still apply first.
    expect(replyFilesAccess({ ...cloud, temporary: true, computer: { description: mac } })).toEqual({ allowed: false })
    expect(replyFilesAccess({ ...cloud, filesEnabled: false, computer: { description: mac } })).toEqual({ allowed: false })
  })
})
