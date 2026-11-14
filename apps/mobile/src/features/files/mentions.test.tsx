// @vitest-environment jsdom
import type { FileNode, FileReference } from '@pulpo/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ searchFiles: vi.fn() }))
vi.mock('./api', () => ({ searchFiles: api.searchFiles }))
vi.mock('./queries', () => ({ filesQueryKeys: { search: (namespace: string, query: string, limit: number) => ['files', namespace, 'search', query, limit] } }))
vi.mock('./display', () => ({ fileIcon: (node: FileNode) => ({ symbol: node.kind === 'folder' ? 'folder.fill' : 'doc.fill', tint: '#00f' }) }))
vi.mock('../../theme', () => ({ useAppTheme: () => ({ text: '#111', secondary: '#666', separator: '#ddd', fill: '#eee', fillStrong: '#ddd' }) }))
vi.mock('../../platform/SymbolView', () => ({ SymbolView: ({ name }: { name: string }) => createElement('i', { 'data-symbol': name }) }))
vi.mock('react-native', () => {
  const container = ({ children, accessibilityLabel }: { children?: ReactNode; accessibilityLabel?: string }) => createElement('div', { 'aria-label': accessibilityLabel }, children)
  return {
    Platform: { OS: 'ios' },
    View: container, Text: container,
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    Pressable: ({ children, onPress, accessibilityLabel }: { children: ReactNode; onPress: () => void; accessibilityLabel?: string }) => (
      createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel }, children)
    ),
  }
})

const { useFileMentionSuggestions } = await import('./mentions')
const { FileMentionList } = await import('./components/FileMentionList')

const node = (id: string, name: string, kind: FileNode['kind'] = 'doc'): FileNode => ({
  id, parentId: null, kind, name, status: 'ready', mimeType: null, sizeBytes: 1, revision: 0, trashedAt: null, createdAt: '', updatedAt: '',
})
const plan = node('plan-id', 'Plan.md')
const planning = node('planning-id', 'Planning')
const notes = node('notes-id', 'Notes', 'folder')
const work = { id: 'work-id', name: 'Work' }

const chosen = vi.fn()
const NO_REFERENCES: FileReference[] = []
function Harness({ text, focused = true, references = NO_REFERENCES }: { text: string; focused?: boolean; references?: FileReference[] }) {
  const { query, suggestions } = useFileMentionSuggestions({
    namespace: 'account', enabled: focused, text, selection: { start: text.length, end: text.length }, references,
  })
  return <FileMentionList query={query} suggestions={suggestions} onChoose={chosen} />
}

let root: Root
let host: HTMLDivElement
let client: QueryClient
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  client = new QueryClient()
  api.searchFiles.mockImplementation(async (query: string) => ({
    items: [plan, planning, notes]
      .filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))
      .map((item) => ({ node: item, parent: item === planning ? work : null })),
  }))
})
afterEach(() => { act(() => root.unmount()); host.remove(); client.clear() })

const render = (props: Parameters<typeof Harness>[0]) => act(() => root.render(<QueryClientProvider client={client}><Harness {...props} /></QueryClientProvider>))
// Past the search delay, then once more for the answer: act holds React's work until it returns.
const wait = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)) })
const settle = async () => { await wait(); await wait() }
const rows = () => [...host.querySelectorAll('button')].map((button) => button.getAttribute('aria-label'))

describe('Files suggestions for an @ word', () => {
  it('searches once typing pauses and lists matches with their folders', async () => {
    render({ text: 'summarize ' })
    render({ text: 'summarize @p' })
    render({ text: 'summarize @pl' })
    expect(api.searchFiles).not.toHaveBeenCalled()
    await settle()
    expect(api.searchFiles).toHaveBeenCalledTimes(1)
    expect(api.searchFiles).toHaveBeenCalledWith('pl', 8, expect.anything())
    expect(host.textContent).toContain('Mention from Files')
    expect(rows()).toEqual(['Mention Plan.md, in My files', 'Mention Planning, in Work'])
    act(() => (host.querySelector('button') as HTMLButtonElement).click())
    expect(chosen).toHaveBeenCalledWith({ node: plan, parent: null, id: 'plan-id' })
  })

  it('lists recent items for a bare @ and leaves out ones already mentioned', async () => {
    render({ text: '@', references: [{ id: 'plan-id', name: 'Plan.md', folder: false }] })
    await settle()
    expect(api.searchFiles).toHaveBeenCalledWith('', 9, expect.anything())
    expect(host.textContent).toContain('Recent in Files')
    expect(rows()).toEqual(['Mention Planning, in Work', 'Mention Notes, in My files'])
  })

  it('shows nothing for an @ inside a word, without focus, or with no match', async () => {
    render({ text: 'mail a@b' })
    await settle()
    render({ text: '@pl', focused: false })
    await settle()
    expect(api.searchFiles).not.toHaveBeenCalled()
    expect(host.textContent).toBe('')

    render({ text: '@zzz' })
    await settle()
    expect(api.searchFiles).toHaveBeenCalledWith('zzz', 8, expect.anything())
    expect(host.textContent).toBe('')
  })

  it('never shows one word’s results for another', async () => {
    render({ text: '@pl' })
    await settle()
    expect(rows()).toHaveLength(2)
    // A new word: nothing until its own answer arrives.
    render({ text: '@pl @no' })
    expect(rows()).toEqual([])
    await settle()
    expect(rows()).toEqual(['Mention Notes, in My files'])
  })

  it('keeps the list up for the same word while the next answer is on its way', async () => {
    render({ text: '@pla' })
    await settle()
    expect(rows()).toHaveLength(2)
    render({ text: '@plan' })
    expect(rows()).toHaveLength(2)
    await settle()
    expect(rows()).toEqual(['Mention Plan.md, in My files', 'Mention Planning, in Work'])
  })
})
