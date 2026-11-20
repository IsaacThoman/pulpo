import { WORKSPACE_SCREEN_CONTROL_RENEW_MS } from '@pulpo/contracts'

/** Why control ended without the user handing it back. */
export type ControlLoss = 'lost'

export interface ControlSessionOptions {
  /** Posts `{ held }` and resolves to the `held` the server answered. */
  post: (held: boolean) => Promise<boolean>
  /** Control was taken, given back or lost. */
  onChange: (held: boolean, loss?: ControlLoss) => void
  /** A renewal request failed (control is then lost); for errors that mean more than that. */
  onRenewError?: (error: unknown) => void
  renewMs?: number
}

/**
 * The viewer's hold on the workspace's screen. Control lapses on the server unless it is renewed,
 * so a viewer that holds it renews it every few seconds; if a renewal fails, the viewer is only
 * watching again.
 */
export class ControlSession {
  private held = false
  private timer: ReturnType<typeof setInterval> | null = null
  private renewing = false
  /** Bumped by every take and release, so an answer that arrives late does not undo a newer one. */
  private generation = 0

  constructor(private readonly options: ControlSessionOptions) {}

  get isHeld(): boolean {
    return this.held
  }

  /**
   * `held`: control was taken. `refused`: the server did not give it. `cancelled`: it was handed
   * back (or the viewer closed) while the request was out. Throws when the request failed.
   */
  async take(): Promise<'held' | 'refused' | 'cancelled'> {
    const generation = ++this.generation
    const held = await this.options.post(true)
    if (generation !== this.generation) {
      if (held) void this.options.post(false).catch(() => undefined)
      return 'cancelled'
    }
    if (!held) return 'refused'
    this.held = true
    this.startRenewing()
    this.options.onChange(true)
    return 'held'
  }

  /** Gives control back, if it is held or being taken. Never throws: control lapses by itself anyway. */
  release(): void {
    // A take still in flight sees the new generation and gives control back when it lands.
    this.generation += 1
    this.stopRenewing()
    if (!this.held) return
    this.held = false
    void this.options.post(false).catch(() => undefined)
    this.options.onChange(false)
  }

  /** The server said control is not held (an input was refused): watch again without asking it. */
  lose(): void {
    if (!this.held) return
    this.generation += 1
    this.stopRenewing()
    this.held = false
    this.options.onChange(false, 'lost')
  }

  private startRenewing(): void {
    this.stopRenewing()
    this.timer = setInterval(() => { void this.renew() }, this.options.renewMs ?? WORKSPACE_SCREEN_CONTROL_RENEW_MS)
  }

  private stopRenewing(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async renew(): Promise<void> {
    if (!this.held || this.renewing) return
    const generation = this.generation
    this.renewing = true
    let held = false
    try {
      held = await this.options.post(true)
    } catch (error) {
      held = false
      if (generation === this.generation) this.options.onRenewError?.(error)
    } finally {
      this.renewing = false
    }
    if (generation !== this.generation || held) return
    this.lose()
  }
}
