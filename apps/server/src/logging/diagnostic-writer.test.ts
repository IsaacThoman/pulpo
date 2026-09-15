import { describe, expect, it, vi } from 'vitest'
import { DiagnosticWriter } from './diagnostic-writer.js'

describe('bounded diagnostic writer', () => {
  it('coalesces updates and never waits for a stalled database on enqueue', async () => {
    let release!: () => void
    const persist = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
    const writer = new DiagnosticWriter(persist, vi.fn())
    writer.enqueue('a', { status: 'in_progress' }); writer.enqueue('a', { status: 'completed' })
    const flushing = writer.flush()
    expect(persist).toHaveBeenCalledWith(['{"status":"completed"}'])
    expect(writer.enqueue('b', { status: 'completed' })).toBeUndefined()
    release(); await Promise.resolve(); await Promise.resolve()
    release(); await flushing
  })
  it('bounds queued bytes/rows and reports discarded work', async () => {
    const report = vi.fn(), persist = vi.fn().mockResolvedValue(undefined)
    const writer = new DiagnosticWriter(persist, report, { records: 2, bytes: 100, batch: 1 })
    writer.enqueue('a', 'one'); writer.enqueue('b', 'two'); writer.enqueue('c', 'three'); writer.enqueue('a', 'x'.repeat(200))
    expect(writer.droppedRecords).toBe(2)
    await writer.flush(); expect(persist).toHaveBeenCalledTimes(2)
  })
  it('drops failed batches and serialization errors without throwing or retrying', async () => {
    const persist = vi.fn().mockRejectedValue(new Error('database unavailable'))
    const writer = new DiagnosticWriter(persist, vi.fn())
    writer.enqueue('bad', { toJSON() { throw new Error('cannot serialize') } })
    writer.enqueue('a', {})
    await expect(writer.flush()).resolves.toBeUndefined()
    expect(writer.droppedRecords).toBe(2); expect(persist).toHaveBeenCalledOnce()
  })
  it('bounds shutdown and refuses new work', async () => {
    let release!: () => void
    const writer = new DiagnosticWriter(() => new Promise<void>(resolve => { release = resolve }), vi.fn())
    writer.enqueue('a', {})
    await writer.close(10)
    writer.enqueue('b', {})
    expect(writer.droppedRecords).toBe(1)
    release()
  })
})
