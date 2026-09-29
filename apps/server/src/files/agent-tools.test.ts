import { describe, expect, it, vi } from 'vitest'

vi.mock('../database/client.js', () => ({ db: {} }))
vi.mock('../storage/index.js', () => ({ getBlobStore: vi.fn() }))
vi.mock('./doc-store.js', () => ({}))
vi.mock('./tree-service.js', () => ({}))
const { applyTextEdits, describeFileScope } = await import('./agent-tools.js')

const folder = { id: 'f', kind: 'folder', name: 'Projects' } as never
const doc = { id: 'd', kind: 'doc', name: 'Plan.md' } as never

describe('agent file tools', () => {
  it('replaces each exact text once, in order', () => {
    expect(applyTextEdits('# Plan\n\nA\n', [{ oldText: 'A', newText: 'B' }, { oldText: '# Plan', newText: '# Plan v2' }])).toBe('# Plan v2\n\nB\n')
  })

  it('refuses missing or ambiguous text so the agent rereads instead of guessing', () => {
    expect(() => applyTextEdits('a a', [{ oldText: 'a', newText: 'b' }])).toThrow(/more than once/)
    expect(() => applyTextEdits('abc', [{ oldText: 'z', newText: 'b' }])).toThrow(/not found/)
  })

  it('tells the agent which items it can reach and how paths start', () => {
    const scoped = describeFileScope([{ label: 'Projects', node: folder }, { label: 'Plan.md', node: doc }])
    expect(scoped).toContain('`Projects/` (folder, with everything inside it)')
    expect(scoped).toContain('`Plan.md` (Markdown document)')
    expect(describeFileScope([{ label: '', node: null }])).toContain('All of the user\'s files')
  })
})
