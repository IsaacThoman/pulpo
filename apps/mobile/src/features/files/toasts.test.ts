import { afterEach, describe, expect, it, vi } from 'vitest'
import { filesToastAnnouncement, filesToastDuration, setFilesToastScreenReaderEnabled, useFilesToasts } from './toasts'

afterEach(() => {
  setFilesToastScreenReaderEnabled(false)
  useFilesToasts.getState().dismiss()
  vi.useRealTimers()
})

describe('Files toasts', () => {
  it('tells screen reader users that Undo is there', () => {
    expect(filesToastAnnouncement({ message: 'Moved to Trash', undo: async () => undefined })).toBe('Moved to Trash, Undo available')
    expect(filesToastAnnouncement({ message: 'Link copied' })).toBe('Link copied')
  })

  it('keeps an Undo toast up much longer while a screen reader runs', () => {
    expect(filesToastDuration({ undo: false, screenReader: true })).toBe(5_000)
    expect(filesToastDuration({ undo: true, screenReader: false })).toBe(7_000)
    expect(filesToastDuration({ undo: true, screenReader: true })).toBe(60_000)
  })

  it('times the shown toast by the screen reader state', () => {
    vi.useFakeTimers()
    setFilesToastScreenReaderEnabled(true)
    useFilesToasts.getState().show({ message: 'Moved to Trash', undo: async () => undefined })
    vi.advanceTimersByTime(59_000)
    expect(useFilesToasts.getState().toast?.message).toBe('Moved to Trash')
    vi.advanceTimersByTime(1_000)
    expect(useFilesToasts.getState().toast).toBeNull()
  })
})
