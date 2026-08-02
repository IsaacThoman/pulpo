import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceTools } from './tools.js'
import type { WorkspaceManager } from './controller.js'

describe('agent workspace tools', () => {
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
