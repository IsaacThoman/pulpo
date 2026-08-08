import { describe, expect, it } from 'vitest'
import { composerPrimaryAction, shouldQueueComposerMessage } from './composer-queue'

describe('queued composer behavior', () => {
  it('shows stop only for an active turn with an empty draft', () => {
    expect(composerPrimaryAction(true, false)).toBe('stop')
    expect(composerPrimaryAction(true, true)).toBe('send')
    expect(composerPrimaryAction(false, false)).toBe('send')
  })

  it('queues behind either an active turn or an existing queue', () => {
    expect(shouldQueueComposerMessage(true, 0)).toBe(true)
    expect(shouldQueueComposerMessage(false, 2)).toBe(true)
    expect(shouldQueueComposerMessage(false, 0)).toBe(false)
  })
})
