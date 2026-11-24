import {
  WORKSPACE_SCREEN_INPUT_MAX_EVENTS,
  workspaceScreenTextChunks,
  type WorkspaceScreenInputEventInput,
} from '@pulpo/contracts'

/** Two taps this close in time and place are one double click. */
export const DOUBLE_CLICK_MS = 400
const DOUBLE_CLICK_DISTANCE = 8
const MAX_SCROLL_NOTCHES = 20

export interface InputQueueOptions {
  send: (events: WorkspaceScreenInputEventInput[]) => Promise<void>
  /** A request failed; what was still waiting has been dropped, since it followed on from it. */
  onError: (error: unknown) => void
  now?: () => number
}

/** Splits typed text into events no longer than one `text` event may be. */
export function textEvents(text: string): WorkspaceScreenInputEventInput[] {
  return workspaceScreenTextChunks(text).map((chunk) => ({ type: 'text', text: chunk }))
}

/**
 * What the user does while in control, sent in the order it happened with one request at a time.
 * Whatever happens while a request is out goes in the next one, so a slow connection sends fewer,
 * larger batches instead of falling behind. Scroll notches at one point add up, and a second tap
 * right after the first, at the same spot, becomes a double click.
 */
export class InputQueue {
  private queue: Array<{ event: WorkspaceScreenInputEventInput; at: number }> = []
  private sending = false
  /** When the last tap was, while it is the last thing waiting to be sent. */
  private lastClickAt: number | null = null
  private generation = 0

  constructor(private readonly options: InputQueueOptions) {}

  push(event: WorkspaceScreenInputEventInput): void {
    const at = this.options.now?.() ?? Date.now()
    if (!this.merge(event, at)) this.queue.push({ event, at })
    this.lastClickAt = event.type === 'click' ? at : null
    void this.flush()
  }

  /** Drops what has not been sent, as when control ends. */
  clear(): void {
    this.generation += 1
    this.queue = []
    this.lastClickAt = null
  }

  get pending(): number {
    return this.queue.length
  }

  private merge(event: WorkspaceScreenInputEventInput, at: number): boolean {
    const last = this.queue.at(-1)
    if (!last) return false
    const previous = last.event
    if (event.type === 'scroll' && previous.type === 'scroll' && previous.x === event.x && previous.y === event.y) {
      const dx = (previous.dx ?? 0) + (event.dx ?? 0)
      const dy = (previous.dy ?? 0) + (event.dy ?? 0)
      if (Math.abs(dx) > MAX_SCROLL_NOTCHES || Math.abs(dy) > MAX_SCROLL_NOTCHES) return false
      if (dx === 0 && dy === 0) {
        this.queue.pop()
        return true
      }
      last.event = { ...previous, dx, dy }
      return true
    }
    if (event.type === 'click' && previous.type === 'click' && this.lastClickAt !== null
      && (previous.button ?? 'left') === (event.button ?? 'left')
      && at - this.lastClickAt <= DOUBLE_CLICK_MS
      && Math.abs(previous.x - event.x) <= DOUBLE_CLICK_DISTANCE
      && Math.abs(previous.y - event.y) <= DOUBLE_CLICK_DISTANCE) {
      const count = (previous.count ?? 1) + 1
      if (count > 3) return false
      last.event = { ...previous, count: count as 1 | 2 | 3 }
      return true
    }
    return false
  }

  private async flush(): Promise<void> {
    if (this.sending) return
    this.sending = true
    try {
      while (this.queue.length) {
        const generation = this.generation
        const batch = this.queue.splice(0, WORKSPACE_SCREEN_INPUT_MAX_EVENTS).map((entry) => entry.event)
        try {
          await this.options.send(batch)
        } catch (error) {
          if (generation !== this.generation) continue
          this.clear()
          this.options.onError(error)
        }
      }
    } finally {
      this.sending = false
    }
  }
}
