const listeners = new Set<(namespace: string) => void>()

export function notifyOutboxChanged(namespace: string): void {
  for (const listener of listeners) listener(namespace)
}

export function subscribeToOutboxChanges(listener: (namespace: string) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
