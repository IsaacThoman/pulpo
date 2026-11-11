// @vitest-environment jsdom
import type { FileNode, FileReference } from '@pulpo/contracts'
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileNodeLookup } from '../queries'

class NetworkError extends Error {}
const query = vi.hoisted(() => ({ value: { data: undefined, error: null } as { data?: unknown; error: unknown }, options: [] as Array<{ queryKey: unknown[]; enabled: boolean }> }))
vi.mock('../../../api/client', () => ({ ApiError: class extends Error {}, isNetworkError: (error: unknown) => error instanceof NetworkError }))
vi.mock('../../../platform/SymbolView', () => ({ SymbolView: ({ name }: { name: string }) => createElement('i', { 'data-symbol': name }) }))
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: { queryKey: unknown[]; enabled: boolean }) => { query.options.push(options); return query.value } }))
vi.mock('../queries', () => ({ fileNodeQuery: (namespace: string, id: string) => ({ queryKey: [namespace, id] }) }))
vi.mock('react-native', () => {
  const container = ({ children }: { children?: ReactNode }) => createElement('div', null, children)
  return {
    View: container, Text: container,
    Pressable: ({ children, onPress, disabled, accessibilityLabel }: { children: ReactNode; onPress: () => void; disabled?: boolean; accessibilityLabel?: string }) => (
      createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children)
    ),
  }
})

const { FileReferenceCard } = await import('./FileReferenceCard')
const { fileReferenceDetails } = await import('../referenceDetails')

const plan: FileReference = { id: 'plan-id', name: 'Plan.md', folder: false }
const projects: FileReference = { id: 'dir-id', name: 'Projects', folder: true }
const node = (overrides: Partial<FileNode>): FileNode => ({
  id: 'plan-id', kind: 'doc', name: 'Plan', parentId: 'work-id', mimeType: null, trashedAt: null, color: null, icon: null,
  ...overrides,
} as FileNode)
const lookup = (value: Partial<FileNode>, ancestors: Array<Partial<FileNode>> = []): FileNodeLookup => ({ node: node(value), ancestors: ancestors.map(node) })
const appearance = { card: {}, tile: {}, copy: {}, name: {}, meta: {}, pressed: {}, badge: {}, badgeColor: '#fff', mutedColor: '#888', tileIconSize: 22 }

describe('fileReferenceDetails', () => {
  it('names the folder the item is in now', () => {
    const details = fileReferenceDetails(plan, lookup({ name: 'Plan (renamed)' }, [{ id: 'root', name: 'Work' }, { id: 'work-id', name: 'Q3' }]), null)
    expect(details).toMatchObject({ name: 'Plan (renamed)', detail: 'In Files · Q3', missing: false, icon: { symbol: 'doc.text.fill' } })
  })

  it('says My files for an item at the top level', () => {
    expect(fileReferenceDetails(projects, lookup({ id: 'dir-id', kind: 'folder', name: 'Projects', parentId: null }), null).detail).toBe('In Files · My files')
  })

  it('is just in Files until the item loads, or while offline', () => {
    expect(fileReferenceDetails(plan, undefined, null)).toMatchObject({ name: 'Plan.md', detail: 'In Files', missing: false, icon: { symbol: 'doc.plaintext.fill' } })
    expect(fileReferenceDetails(projects, undefined, null).icon.symbol).toBe('folder.fill')
    expect(fileReferenceDetails(plan, undefined, new NetworkError('offline'))).toMatchObject({ detail: 'In Files', missing: false })
  })

  it('is no longer in Files once trashed, or when it can’t be found', () => {
    expect(fileReferenceDetails(plan, lookup({ trashedAt: '2026-11-01T00:00:00Z' }), null)).toMatchObject({ detail: 'No longer in Files', missing: true })
    expect(fileReferenceDetails(plan, undefined, new Error('not found'))).toMatchObject({ detail: 'No longer in Files', missing: true })
  })
})

describe('FileReferenceCard', () => {
  let root: Root
  let host: HTMLDivElement
  const onOpen = vi.fn()
  beforeEach(() => {
    vi.clearAllMocks()
    query.value = { data: undefined, error: null }
    query.options = []
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(() => { act(() => root.unmount()); host.remove() })
  const render = (props: { namespace?: string | null; chevron?: boolean } = {}) => act(() => root.render(
    <FileReferenceCard namespace={props.namespace === undefined ? 'account' : props.namespace} reference={plan} appearance={{ ...appearance, chevron: props.chevron }} onOpen={onOpen} />,
  ))
  const button = () => host.querySelector('button')!

  it('shows the item with its icon, Files badge, and folder, and opens it', () => {
    query.value = { data: lookup({ kind: 'blob', name: 'Plan.md', mimeType: 'text/markdown' }, [{ id: 'work-id', name: 'Work' }]), error: null }
    render()
    expect(query.options[0]).toMatchObject({ queryKey: ['account', 'plan-id'], enabled: true })
    expect(host.textContent).toContain('Plan.md')
    expect(host.textContent).toContain('In Files · Work')
    expect([...host.querySelectorAll('i')].map((icon) => icon.dataset.symbol)).toEqual(['doc.plaintext.fill', 'link'])
    expect(button().getAttribute('aria-label')).toBe('Open Plan.md, In Files · Work')
    act(() => button().click())
    expect(onOpen).toHaveBeenCalledWith(plan)
  })

  it('ends with a chevron in a sent message', () => {
    render({ chevron: true })
    expect([...host.querySelectorAll('i')].map((icon) => icon.dataset.symbol)).toContain('chevron.right')
  })

  it('does not look the item up without Files', () => {
    render({ namespace: null })
    expect(query.options[0]).toMatchObject({ enabled: false })
    expect(host.textContent).toContain('In Files')
  })

  it('reads as gone, and can’t be opened, once the item is trashed', () => {
    query.value = { data: lookup({ trashedAt: '2026-11-01T00:00:00Z' }), error: null }
    render({ chevron: true })
    expect(host.textContent).toContain('No longer in Files')
    expect(button().disabled).toBe(true)
    expect([...host.querySelectorAll('i')].map((icon) => icon.dataset.symbol)).toEqual(['doc.text.fill'])
  })
})
