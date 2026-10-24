// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const kept = vi.hoisted(() => new Map<string, unknown>())
vi.mock('../../data/database', () => ({
  getValue: async (namespace: string, key: string) => kept.get(`${namespace}:${key}`) ?? null,
  setValue: async (namespace: string, key: string, value: unknown) => { kept.set(`${namespace}:${key}`, value) },
}))

const { useSidebarExpansion } = await import('./expansion')

beforeEach(() => {
  kept.clear()
  useSidebarExpansion.setState({ namespace: '', expanded: new Set() })
})

describe('open drawer folders', () => {
  it('are remembered per account on the device', async () => {
    const store = useSidebarExpansion.getState()
    store.load('a')
    store.setExpanded('work', true)
    store.setExpanded('shortcut:x', true)
    store.setExpanded('shortcut:x', false)
    await vi.waitFor(() => expect(kept.get('a:sidebar:expanded')).toEqual(['work']))

    useSidebarExpansion.getState().load('b')
    expect(useSidebarExpansion.getState().expanded.size).toBe(0)
    useSidebarExpansion.getState().load('a')
    await vi.waitFor(() => expect([...useSidebarExpansion.getState().expanded]).toEqual(['work']))
  })

  it('keep folders opened while the saved ones load', async () => {
    kept.set('a:sidebar:expanded', ['saved'])
    useSidebarExpansion.getState().load('a')
    useSidebarExpansion.getState().setExpanded('now', true)
    await vi.waitFor(() => expect([...useSidebarExpansion.getState().expanded].sort()).toEqual(['now', 'saved']))
    await vi.waitFor(() => expect((kept.get('a:sidebar:expanded') as string[]).sort()).toEqual(['now', 'saved']))
  })
})
