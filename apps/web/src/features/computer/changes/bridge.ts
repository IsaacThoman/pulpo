import { useCallback, useEffect, useState } from 'react'
import type { ComputerChange, ComputerChangesItem, DesktopComputerApi } from '@pulpo/contracts'

/**
 * The desktop app's "This computer" bridge, or undefined in a browser and in desktop builds that
 * predate it. Read loosely so this compiles before and after `DesktopApi` declares `computer`.
 */
export function computerBridge(): DesktopComputerApi | undefined {
  if (typeof window === 'undefined') return undefined
  return (window.pulpoDesktop as unknown as { computer?: DesktopComputerApi } | undefined)?.computer
}

/** Whether this client is a desktop app that can lend its computer ("this computer" vs "your computer"). */
export function hasComputerBridge(): boolean {
  return Boolean(computerBridge())
}

export function computerChangesItem(outputItems: readonly unknown[] | undefined): ComputerChangesItem | null {
  const item = (outputItems ?? []).find((entry) => (entry as { type?: string } | null)?.type === 'pulpo_computer_changes')
  return (item as ComputerChangesItem | undefined) ?? null
}

/** The last segment of an absolute folder path, on macOS or Windows. */
export function computerFolderName(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path
}

/** Waiting for the user: suggested and undecided, or an accept that found the file changed since. */
/** A long folder path with its start cut off at a separator: the end is what tells folders apart. */
export function computerPathTail(path: string, maxLength = 60): string {
  if (path.length <= maxLength) return path
  const separator = path.includes('\\') && !path.includes('/') ? '\\' : '/'
  const segments = path.split(separator)
  let tail = segments.pop() ?? ''
  while (segments.length && tail.length + 1 + segments.at(-1)!.length <= maxLength - 2) tail = `${segments.pop()}${separator}${tail}`
  return `…${separator}${tail}`
}

export function computerChangeNeedsReview(change: ComputerChange): boolean {
  return change.status === 'pending' || change.status === 'conflict'
}

export function computerChangeIsDone(change: ComputerChange): boolean {
  return change.status === 'applied' || change.status === 'accepted'
}

/**
 * What a reply's bar shows: the session's own changes, plus everything still waiting for review in
 * the same folder, whichever reply suggested it. The agent already sees those files as accepted,
 * so a suggestion must never wait where the user cannot find it (a deleted chat, an older reply).
 */
async function listComputerChanges(bridge: DesktopComputerApi, sessionId: string): Promise<ComputerChange[]> {
  const own = await bridge.changes.list({ sessionIds: [sessionId] })
  const folder = own[0]?.folder
  if (!folder) return own
  const waiting = (await bridge.changes.list({ folder })).filter(computerChangeNeedsReview)
  const waitingIds = new Set(waiting.map((change) => change.id))
  return [...own.filter((change) => !waitingIds.has(change.id)), ...waiting]
}

/**
 * A session's changes from the desktop app's store, kept fresh as they are added or decided.
 * `changes` is null until the first answer, and stays empty when this app does not know the
 * session (the reply came from another computer).
 */
export function useComputerChanges(bridge: DesktopComputerApi | undefined, sessionId: string) {
  const [changes, setChanges] = useState<ComputerChange[] | null>(null)
  const refresh = useCallback(async () => {
    if (!bridge) return
    try {
      setChanges(await listComputerChanges(bridge, sessionId))
    } catch {
      setChanges((current) => current ?? [])
    }
  }, [bridge, sessionId])
  useEffect(() => {
    if (!bridge) return
    let live = true
    const load = () => {
      void listComputerChanges(bridge, sessionId)
        .then((next) => { if (live) setChanges(next) })
        .catch(() => { if (live) setChanges((current) => current ?? []) })
    }
    load()
    const unsubscribe = bridge.changes.onChanged(load)
    return () => {
      live = false
      unsubscribe()
    }
  }, [bridge, sessionId])
  return { changes, refresh }
}
