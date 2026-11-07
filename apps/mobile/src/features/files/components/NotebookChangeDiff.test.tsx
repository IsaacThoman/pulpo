import { renderToStaticMarkup } from 'react-dom/server'
import { diffNotebookFiles } from '@pulpo/client-core/office/notebook'
import type { FileChangeSummary } from '@pulpo/contracts'
import { expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ diff: null as ReturnType<typeof diffNotebookFiles> | null }))
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ isPending: false, isError: false, data: fixture.diff }) }))
vi.mock('../../../theme', () => ({ useAppTheme: () => ({}) }))
vi.mock('../api', () => ({ fetchChangeContent: vi.fn() }))
vi.mock('../display', () => ({ filesErrorMessage: String }))
vi.mock('react-native', async () => {
  const { createElement } = await import('react')
  return {
    Platform: { select: (options: { default: unknown }) => options.default },
    StyleSheet: { create: (styles: unknown) => styles },
    View: ({ children }: { children: React.ReactNode }) => createElement('div', null, children),
    Text: ({ children }: { children: React.ReactNode }) => createElement('span', null, children),
    ActivityIndicator: () => null,
  }
})
import { NotebookChangeDiff } from './NotebookChangeDiff'

it('shows a metadata-only cell proposal as edited and names the changed settings', () => {
  const file = (hidden: boolean) => new TextEncoder().encode(JSON.stringify({
    nbformat: 4, nbformat_minor: 5, metadata: {}, cells: [{
      id: 'a', cell_type: 'markdown', source: 'unchanged source', metadata: { jupyter: { source_hidden: hidden } },
    }],
  }))
  fixture.diff = diffNotebookFiles(file(false), file(true))
  const html = renderToStaticMarkup(<NotebookChangeDiff change={{ id: 'change' } as FileChangeSummary} queryKey={['change']} />)
  expect(html).toContain('1 cell edited')
  expect(html).toContain('Edited')
  expect(html).toContain('Cell settings changed: jupyter')
  expect(html).not.toContain('The two versions are the same.')
  expect(html).not.toContain('Outputs changed')
})
