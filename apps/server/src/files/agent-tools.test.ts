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

  it('lists every attached item with the path the tools use, and where paths start', () => {
    const scoped = describeFileScope({
      roots: [{ label: 'Projects', node: folder }],
      attached: [
        { path: 'Projects', node: folder, location: 'Work' },
        { path: 'Projects/Plan.md', node: doc, location: null },
      ],
    })
    expect(scoped).toContain('- `Projects/` (folder, with everything inside it; it is in their Files at `Work/`)')
    expect(scoped).toContain('- `Projects/Plan.md` (Markdown document)')
    expect(scoped).toContain('Paths start with `Projects`.')
    const all = describeFileScope({ roots: [{ label: '', node: null }], attached: [{ path: '', node: null, location: null }, { path: 'Projects/Plan.md', node: doc, location: null }] })
    expect(all).toContain('All of their files')
    expect(all).toContain('- `Projects/Plan.md` (Markdown document)')
  })
})
