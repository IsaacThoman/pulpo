import type { Awareness } from 'y-protocols/awareness'

/** Distinct, readable on light and dark backgrounds. */
const SESSION_COLORS = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#dc2626', '#0891b2', '#65a30d']

export function sessionColor(clientId: number): string {
  return SESSION_COLORS[clientId % SESSION_COLORS.length]!
}

/** Another session with the document open: its awareness client, device label, and cursor color. */
export interface PresencePeer {
  clientId: number
  name: string
  color: string
}

/** Every other session that announced a user, in awareness order. */
export function presencePeers(awareness: Awareness, ownClientId: number): PresencePeer[] {
  const peers: PresencePeer[] = []
  awareness.getStates().forEach((state, clientId) => {
    const user = (state as { user?: { name?: unknown; color?: unknown } }).user
    if (clientId === ownClientId || typeof user?.name !== 'string' || !user.name) return
    peers.push({ clientId, name: user.name, color: typeof user.color === 'string' ? user.color : sessionColor(clientId) })
  })
  return peers
}

export function samePeers(left: readonly PresencePeer[], right: readonly PresencePeer[]): boolean {
  return left.length === right.length && left.every((peer, index) => {
    const other = right[index]!
    return peer.clientId === other.clientId && peer.name === other.name && peer.color === other.color
  })
}
