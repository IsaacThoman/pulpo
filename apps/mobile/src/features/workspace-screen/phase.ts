import type { WorkspaceScreenStatus } from '@pulpo/contracts'
import { isUnfundedError } from './api'
import type { Size } from './geometry'

/** What the viewer shows: the live screen, or a message in its place. */
export type ViewerPhase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'none' }
  | { kind: 'unavailable' }
  /** A request was refused because the user can't pay for the next minute; nothing is retried. */
  | { kind: 'unfunded' }
  /** `billed`: watching is charged by the minute on this instance. */
  | { kind: 'ready'; screen: Size; billed: boolean }

export function statusPhase(status: WorkspaceScreenStatus): ViewerPhase {
  if (status.state !== 'ready') return { kind: status.state }
  return {
    kind: 'ready',
    screen: { width: status.width, height: status.height },
    billed: (status.pricePerMinuteMicros ?? 0) > 0,
  }
}

/** The status request failed. */
export function failurePhase(error: unknown): ViewerPhase {
  if (isUnfundedError(error)) return { kind: 'unfunded' }
  return { kind: 'error', message: error instanceof Error && error.message ? error.message : "Couldn't open the screen." }
}
