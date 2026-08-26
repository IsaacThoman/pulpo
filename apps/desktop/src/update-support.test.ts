import { describe, expect, it } from 'vitest'
import { desktopUpdatesSupported } from './update-support'

describe('desktopUpdatesSupported', () => {
  it('supports packaged macOS builds on both architectures', () => {
    expect(desktopUpdatesSupported(true, 'darwin', 'x64')).toBe(true)
    expect(desktopUpdatesSupported(true, 'darwin', 'arm64')).toBe(true)
  })

  it('supports packaged Windows x64 builds', () => {
    expect(desktopUpdatesSupported(true, 'win32', 'x64')).toBe(true)
  })

  it('disables Windows ARM64 updates while the public Squirrel feed has one shared manifest', () => {
    expect(desktopUpdatesSupported(true, 'win32', 'arm64')).toBe(false)
  })

  it('does not update unpackaged or Linux builds', () => {
    expect(desktopUpdatesSupported(false, 'win32', 'x64')).toBe(false)
    expect(desktopUpdatesSupported(true, 'linux', 'x64')).toBe(false)
  })
})
