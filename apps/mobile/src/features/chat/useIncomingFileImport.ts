import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { IncomingFile, IncomingFileQueue } from './incomingFileQueue'

export function useIncomingFileImport(queue: IncomingFileQueue, options: {
  namespace: string | null
  ready: boolean
  accept: (item: IncomingFile) => { accepted: boolean; saved: Promise<void> }
  report: (message: string) => void
}) {
  const items = useSyncExternalStore(queue.subscribe, queue.getSnapshot)
  const attempted = useRef(new Set<string>())
  const latest = useRef(options)
  latest.current = options
  useEffect(() => {
    if (!options.ready || !options.namespace) return
    // Accept synchronously in delivery order; attachment refs reflect earlier imports
    // before React renders. Acknowledge only after the draft has reached disk.
    for (const item of items) {
      if (item.namespace !== options.namespace || (!item.file && !item.error) || attempted.current.has(item.id)) continue
      if (!queue.getSnapshot().some((current) => current.id === item.id && current.namespace === options.namespace)) continue
      attempted.current.add(item.id)
      const result = item.error
        ? (options.report(item.error), { accepted: false, saved: Promise.resolve() })
        : options.accept(item)
      void result.saved.then(() => queue.finish(item.id, result.accepted)).catch(() => {
        if (latest.current.namespace === item.namespace) {
          latest.current.report('The imported draft could not be saved. Keep Pulpo open and try again after freeing storage.')
        }
      })
    }
  }, [items, options, queue])
}
