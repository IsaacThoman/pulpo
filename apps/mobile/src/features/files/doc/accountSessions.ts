import type { DocSocket } from '@pulpo/client-core/doc-sync'
import { AppState } from 'react-native'
import { withMobileDatabase } from '../../../data/database'
import { EDITOR_BUNDLE } from '../editor/editorBundle.generated'
import { closeDocSessions, docSessions, DocSessionRegistry } from './sessions'
import { DocStore, type DocDatabase } from './store'

const store = new DocStore((operation) => withMobileDatabase((database) => operation(database as unknown as DocDatabase)))

/** The account's open documents. Their schema is the bundled editor's, which the server checks on join. */
export function accountDocSessions(namespace: string): DocSessionRegistry {
  return docSessions(namespace, () => new DocSessionRegistry(namespace, store, EDITOR_BUNDLE.schemaVersion))
}

/** How many of the account's documents have edits not uploaded yet (signing out deletes them). */
export async function unsyncedDocumentCount(namespace: string): Promise<number> {
  return (await store.dirtyDocIds(namespace)).length
}

/**
 * Connects the account's documents to its realtime socket, and uploads edits made offline to
 * documents that are not open whenever the socket (re)connects or the app returns. Leaving the
 * app writes what open documents have pending at once, in case it is ended in the background.
 */
export function bindMobileDocSocket(namespace: string, socket: DocSocket & { on(event: 'connect', listener: () => void): unknown; off(event: 'connect', listener: () => void): unknown }): () => void {
  const registry = accountDocSessions(namespace)
  registry.attach(socket)
  const flush = () => { void registry.flushDirty() }
  socket.on('connect', flush)
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active' && socket.connected) flush()
    else if (state === 'background') void registry.flushOpen().catch(() => undefined)
  })
  if (socket.connected) flush()
  return () => {
    socket.off('connect', flush)
    appState.remove()
    registry.attach(null)
  }
}

export { closeDocSessions }
