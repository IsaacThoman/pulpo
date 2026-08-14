import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceTools } from './tools.js'
import type { WorkspaceManager } from './controller.js'
import { READ_MAX_OUTPUT_BYTES } from './bounded-read.js'

describe('agent workspace tools', () => {
  it('forwards bounded read arguments and returns daemon metadata', async () => {
    const details = {
      kind: 'bounded_read' as const, version: 1 as const, offset: 5, firstLine: 5, lastLine: 6,
      returnedLines: 2, nextOffset: 7, eof: false, truncated: true, longLines: 0,
      totalLines: null, maxOutputBytes: READ_MAX_OUTPUT_BYTES,
    }
    const execute = vi.fn().mockResolvedValue({ output: '5: five\n6: six\n\n[Showing lines 5-6. Continue with offset=7.]', details })
    const tools = createWorkspaceTools({ execute } as unknown as WorkspaceManager, 1_000)
    const tool = tools.find((candidate) => candidate.name === 'read')

    const result = await tool!.execute('read-1', { path: '/workspace/file.txt', offset: 5, limit: 2 })

    expect(execute).toHaveBeenCalledWith(
      'read-1', 'read', { path: '/workspace/file.txt', offset: 5, limit: 2 }, undefined, undefined, expect.any(Function),
    )
    expect(result.content).toEqual([{ type: 'text', text: '5: five\n6: six\n\n[Showing lines 5-6. Continue with offset=7.]' }])
    expect(result.details).toEqual(details)
  })

  it('bounds raw output returned by a legacy workspace daemon before Pi receives it', async () => {
    const raw = Array.from({ length: 811 }, (_, index) => `${index + 1},${'large-value,'.repeat(30)}`).join('\n')
    const execute = vi.fn().mockResolvedValue({ output: raw })
    const tools = createWorkspaceTools({ execute } as unknown as WorkspaceManager, 1_000)
    const tool = tools.find((candidate) => candidate.name === 'read')

    const result = await tool!.execute('read-legacy', { path: '/workspace/events.csv' })
    const output = (result.content[0] as { text: string }).text

    expect(Buffer.byteLength(output, 'utf8')).toBeLessThanOrEqual(READ_MAX_OUTPUT_BYTES)
    expect(output).toContain('Output capped at 50 KiB')
    expect(output).toMatch(/Continue with offset=\d+/u)
    expect(result.details).toMatchObject({ kind: 'bounded_read', version: 1, eof: false, truncated: true })
  })

  it('rejects incompatible readAll pagination before executing the workspace operation', async () => {
    const execute = vi.fn()
    const tools = createWorkspaceTools({ execute } as unknown as WorkspaceManager, 1_000)
    const tool = tools.find((candidate) => candidate.name === 'read')

    await expect(tool!.execute('read-invalid', { path: '/workspace/file.txt', readAll: true, offset: 1 })).rejects.toThrow('cannot be combined')
    expect(execute).not.toHaveBeenCalled()
  })

  it('rejects oversized output even when a daemon claims it is bounded', async () => {
    const execute = vi.fn().mockResolvedValue({
      output: 'x'.repeat(READ_MAX_OUTPUT_BYTES + 1),
      details: {
        kind: 'bounded_read', version: 1, offset: 1, firstLine: 1, lastLine: 1,
        returnedLines: 1, nextOffset: null, eof: true, truncated: false, longLines: 0,
        totalLines: 1, maxOutputBytes: READ_MAX_OUTPUT_BYTES,
      },
    })
    const tools = createWorkspaceTools({ execute } as unknown as WorkspaceManager, 1_000)
    const tool = tools.find((candidate) => candidate.name === 'read')

    await expect(tool!.execute('read-oversized', { path: '/workspace/file.txt' })).rejects.toThrow('50 KiB safety limit')
  })

  it('returns view_image bytes only in model-facing content', async () => {
    const viewImage = vi.fn().mockResolvedValue({ data: 'base64-pixels', mimeType: 'image/png', sizeBytes: 123 })
    const tools = createWorkspaceTools({ viewImage } as unknown as WorkspaceManager, 1_000)
    const tool = tools.find((candidate) => candidate.name === 'view_image')

    expect(tool).toBeDefined()
    const result = await tool!.execute('call-1', { path: '/tmp/chart.png' })

    expect(viewImage).toHaveBeenCalledWith('/tmp/chart.png', undefined, expect.any(Function))
    expect(result.content).toEqual([
      { type: 'text', text: 'Viewed /tmp/chart.png (image/png, 123 bytes)' },
      { type: 'image', data: 'base64-pixels', mimeType: 'image/png' },
    ])
    expect(result.details).toEqual({ path: '/tmp/chart.png', mimeType: 'image/png', sizeBytes: 123 })
    expect(JSON.stringify(result.details)).not.toContain('base64-pixels')
  })

  it('attaches a workspace file without returning its bytes to the model', async () => {
    const attach = vi.fn().mockResolvedValue({ id: 'file-1', name: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 456 })
    const tools = createWorkspaceTools({} as WorkspaceManager, 1_000, undefined, attach)
    const tool = tools.find((candidate) => candidate.name === 'attach_file')

    const result = await tool!.execute('call-2', { path: '/workspace/report.pdf' })

    expect(attach).toHaveBeenCalledWith('call-2', '/workspace/report.pdf', undefined, undefined)
    expect(result.content).toEqual([{ type: 'text', text: 'Attached report.pdf (456 bytes)' }])
    expect(result.details).toEqual({ attachment: { id: 'file-1', name: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 456 } })
  })
})
