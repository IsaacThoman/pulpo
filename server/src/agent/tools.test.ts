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
})
