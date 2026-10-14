import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import { db } from '../../database/client.js'
import { fileNodes } from '../../database/schema.js'
import type { FileNodeRow } from '../access.js'

export interface WalkedNode {
  node: FileNodeRow
  /** The agent's path for the item. */
  path: string
  /** 1 for the starting folder's children. */
  depth: number
}

async function childrenOf(userId: string, parentIds: Array<string | null>, limit: number): Promise<FileNodeRow[]> {
  const ids = parentIds.filter((id): id is string => id !== null)
  const parent = parentIds.includes(null) ? isNull(fileNodes.parentId) : inArray(fileNodes.parentId, ids)
  return db.select().from(fileNodes).where(and(
    eq(fileNodes.ownerUserId, userId),
    parent,
    isNull(fileNodes.trashedAt),
    eq(fileNodes.status, 'ready'),
    // Shortcuts are navigation aids for people; the agent works with the items themselves.
    ne(fileNodes.kind, 'shortcut'),
  )).orderBy(desc(sql`${fileNodes.kind} = 'folder'`), asc(sql`lower(${fileNodes.name})`)).limit(limit)
}

/**
 * The live items below a folder (null: the top of My files), in listing order: folders first,
 * then by name, each folder's contents right after it, down to `maxDepth` levels. Reads one level
 * at a time and stops at `maxNodes` (`truncated`), so huge trees cost bounded work; shallower
 * items win when it stops early.
 */
export async function walkTree(userId: string, start: { id: string | null; path: string }, options: { maxDepth: number; maxNodes: number }): Promise<{ nodes: WalkedNode[]; truncated: boolean }> {
  const byParent = new Map<string | null, FileNodeRow[]>()
  let frontier: Array<string | null> = [start.id]
  let total = 0
  let truncated = false
  for (let depth = 1; depth <= options.maxDepth && frontier.length; depth += 1) {
    // Batches keep the parent list of one query reasonable.
    const next: string[] = []
    for (let index = 0; index < frontier.length && !truncated; index += 500) {
      const rows = await childrenOf(userId, frontier.slice(index, index + 500), options.maxNodes - total + 1)
      if (total + rows.length > options.maxNodes) {
        truncated = true
        rows.length = options.maxNodes - total
      }
      total += rows.length
      for (const row of rows) {
        byParent.set(row.parentId, [...byParent.get(row.parentId) ?? [], row])
        if (row.kind === 'folder') next.push(row.id)
      }
    }
    if (truncated) break
    frontier = next
  }
  const nodes: WalkedNode[] = []
  const visit = (parentId: string | null, prefix: string, depth: number) => {
    for (const node of byParent.get(parentId) ?? []) {
      const path = prefix ? `${prefix}/${node.name}` : node.name
      nodes.push({ node, path, depth })
      if (node.kind === 'folder') visit(node.id, path, depth + 1)
    }
  }
  visit(start.id, start.path, 1)
  return { nodes, truncated }
}
