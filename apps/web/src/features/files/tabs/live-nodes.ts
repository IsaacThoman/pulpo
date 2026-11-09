import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/stores/auth'
import { toSnapshot, type TabSnapshot } from './model'

/**
 * Query roots that hold Files items (listings, single items, the trash, and sidebar folders), and
 * chat attachments (see `attachmentQueryKey`), which side panel tabs show.
 */
const ROOTS = new Set(['files', 'trash', 'folders', 'attachment'])
const NODE_KINDS = new Set(['folder', 'doc', 'blob'])
const SINGLE_FIELDS = ['node', 'folder'] as const
const LIST_FIELDS = ['ancestors', 'children', 'items', 'pinnedItems'] as const

type NodeLike = TabSnapshot & { id: string; revision?: unknown; updatedAt?: unknown }

/** How fresh one cached copy of an item is, compared field by field (see `fresher`). */
interface Copy {
  node: NodeLike
  revision: number
  updatedAt: number
  /** Watched and not invalidated: kept fresh by a view, not left behind by one. */
  watched: number
  at: number
}

/**
 * Which copy of an item to believe. A query's update time belongs to the whole query, and
 * optimistic writes touch stale listings too, so the item's own revision and modified time come
 * first (a rename bumps both); appearance changes leave them alone, so then a watched query wins,
 * and only then the newer query.
 */
function fresher(left: Copy, right: Copy): boolean {
  if (left.revision !== right.revision) return left.revision > right.revision
  if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt
  if (left.watched !== right.watched) return left.watched > right.watched
  return left.at >= right.at
}

function isNode(value: unknown): value is NodeLike {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string' && typeof candidate.name === 'string' && typeof candidate.kind === 'string' && NODE_KINDS.has(candidate.kind)
}

/** A cached chat attachment, which looks like a file from the computer. */
function attachmentIn(data: unknown): NodeLike[] {
  if (!data || typeof data !== 'object') return []
  const { id, name, mimeType } = data as Record<string, unknown>
  if (typeof id !== 'string' || typeof name !== 'string') return []
  return [{ id, kind: 'blob', name, mimeType: typeof mimeType === 'string' ? mimeType : null }]
}

/** The Files items a cached query holds, in any of the shapes Files queries use. */
export function nodesIn(data: unknown): NodeLike[] {
  if (Array.isArray(data)) return data.filter(isNode)
  if (!data || typeof data !== 'object') return []
  const record = data as Record<string, unknown>
  const found: NodeLike[] = []
  for (const field of SINGLE_FIELDS) if (isNode(record[field])) found.push(record[field])
  for (const field of LIST_FIELDS) {
    const list = record[field]
    if (Array.isArray(list)) found.push(...list.filter(isNode))
  }
  return found
}

const EMPTY: ReadonlyMap<string, TabSnapshot> = new Map()

function sameSnapshots(left: ReadonlyMap<string, TabSnapshot>, right: ReadonlyMap<string, TabSnapshot>): boolean {
  if (left.size !== right.size) return false
  for (const [id, node] of right) {
    const other = left.get(id)
    if (!other || other.name !== node.name || other.kind !== node.kind || other.mimeType !== node.mimeType
      || other.systemRole !== node.systemRole || other.color !== node.color || other.icon !== node.icon) return false
  }
  return true
}

/**
 * The latest known look (name, kind, color, icon) of the given folders, files and attachments,
 * from whatever data is cached: a tab that is not showing still follows a rename seen in any
 * listing. It never fetches; the showing tab's own view keeps its item fresh.
 */
export function useLiveTabNodes(ids: readonly string[]): ReadonlyMap<string, TabSnapshot> {
  const queryClient = useQueryClient()
  const userId = useAuth((state) => state.user?.id)
  const key = [...new Set(ids)].sort().join(',')
  const [nodes, setNodes] = useState<ReadonlyMap<string, TabSnapshot>>(EMPTY)

  useEffect(() => {
    if (!userId || !key) {
      setNodes(EMPTY)
      return
    }
    const wanted = new Set(key.split(','))
    const cache = queryClient.getQueryCache()
    let frame = 0
    const scan = () => {
      frame = 0
      const latest = new Map<string, Copy>()
      for (const query of cache.getAll()) {
        const [root, owner] = query.queryKey
        if (owner !== userId || typeof root !== 'string' || !ROOTS.has(root) || query.state.data === undefined) continue
        const at = query.state.dataUpdatedAt
        const watched = query.getObserversCount() > 0 && !query.state.isInvalidated ? 1 : 0
        for (const node of root === 'attachment' ? attachmentIn(query.state.data) : nodesIn(query.state.data)) {
          if (!wanted.has(node.id)) continue
          const copy: Copy = {
            node,
            revision: typeof node.revision === 'number' ? node.revision : -1,
            updatedAt: typeof node.updatedAt === 'string' ? Date.parse(node.updatedAt) || 0 : 0,
            watched,
            at,
          }
          const seen = latest.get(node.id)
          if (!seen || fresher(copy, seen)) latest.set(node.id, copy)
        }
      }
      const next = new Map([...latest].map(([id, { node }]) => [id, toSnapshot(node)]))
      setNodes((current) => sameSnapshots(current, next) ? current : next)
    }
    scan()
    const unsubscribe = cache.subscribe((event) => {
      const [root, owner] = event.query.queryKey
      if (owner !== userId || typeof root !== 'string' || !ROOTS.has(root) || frame) return
      frame = requestAnimationFrame(scan)
    })
    return () => {
      unsubscribe()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [key, queryClient, userId])

  return nodes
}
