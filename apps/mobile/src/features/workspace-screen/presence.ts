import type { WorkspaceScreenPresence } from '@pulpo/contracts'

/** How long after the workspace's expiry to ask again, so the answer has had time to change. */
export const PRESENCE_AFTER_EXPIRY_MS = 5_000
/** When the server still calls a workspace live past its expiry, how long before asking again. */
export const PRESENCE_PAST_EXPIRY_RETRY_MS = 30_000
/** The longest a timer can wait (about 24 days); later expiries are checked again then. */
const MAX_TIMER_MS = 2_147_483_647

/**
 * What the reply that offers the chat's screen shows: the button, until an answer says the
 * workspace is gone (and before any answer, since the viewer explains itself), then a note.
 */
export function screenOffer(presence: WorkspaceScreenPresence | undefined): 'open' | 'closed' {
  return presence && !presence.live ? 'closed' : 'open'
}

/** Whether the app is in front, and changes to it. Asking stops while it is in the background. */
export interface PresenceForeground {
  isForeground: () => boolean
  subscribe: (listener: (foreground: boolean) => void) => () => void
}

export interface PresenceTrackerOptions {
  fetchPresence: (chatId: string, signal: AbortSignal) => Promise<WorkspaceScreenPresence>
  foreground?: PresenceForeground
  now?: () => number
}

interface ChatPresence {
  presence: WorkspaceScreenPresence | undefined
  listeners: Set<() => void>
  request: AbortController | null
  timer: ReturnType<typeof setTimeout> | null
}

/**
 * Whether each chat's workspace is still there, for the reply that offers its screen. A chat is
 * asked about when something shows it, again a moment after its workspace's expiry, and whenever
 * `ask` says something changed (a reply finished, the viewer closed); never on an interval, and
 * not while the app is in the background. A failed request keeps the last answer.
 */
export class WorkspaceScreenPresenceTracker {
  private readonly chats = new Map<string, ChatPresence>()
  private foreground = true
  private unsubscribeForeground: (() => void) | null = null

  constructor(private readonly options: PresenceTrackerOptions) {}

  /** The last answer for the chat; undefined before the first one. */
  get(chatId: string): WorkspaceScreenPresence | undefined {
    return this.chats.get(chatId)?.presence
  }

  /** Watches the chat's answer. The first watcher of a chat asks at once. */
  subscribe(chatId: string, listener: () => void): () => void {
    const chat = this.chat(chatId)
    const first = chat.listeners.size === 0
    chat.listeners.add(listener)
    this.watchForeground()
    if (first) this.request(chatId)
    return () => {
      chat.listeners.delete(listener)
      if (chat.listeners.size === 0) this.idle(chat)
      this.watchForeground()
    }
  }

  /** Something changed the workspace's life: asks again when the chat is shown. */
  ask(chatId: string): void {
    const chat = this.chats.get(chatId)
    if (chat?.listeners.size) this.request(chatId)
  }

  /**
   * The chat's newest reply is at work in the workspace, so whatever was answered before is out
   * of date: forget it, so the reply offers the screen until the next answer.
   */
  forget(chatId: string): void {
    const chat = this.chats.get(chatId)
    if (!chat) return
    this.idle(chat)
    if (chat.presence === undefined) return
    chat.presence = undefined
    this.notify(chat)
  }

  private chat(chatId: string): ChatPresence {
    let chat = this.chats.get(chatId)
    if (!chat) {
      chat = { presence: undefined, listeners: new Set(), request: null, timer: null }
      this.chats.set(chatId, chat)
    }
    return chat
  }

  private request(chatId: string): void {
    const chat = this.chat(chatId)
    if (!this.foreground || chat.request) return
    this.clearTimer(chat)
    const controller = new AbortController()
    chat.request = controller
    void this.options.fetchPresence(chatId, controller.signal).then((presence) => {
      if (controller.signal.aborted) return
      chat.request = null
      chat.presence = presence
      this.notify(chat)
      this.schedule(chatId, chat)
    }, () => {
      if (controller.signal.aborted) return
      chat.request = null
    })
  }

  private schedule(chatId: string, chat: ChatPresence): void {
    this.clearTimer(chat)
    const presence = chat.presence
    if (!presence?.live || !presence.expiresAt || !chat.listeners.size || !this.foreground) return
    const expiresAt = Date.parse(presence.expiresAt)
    if (!Number.isFinite(expiresAt)) return
    const untilExpiry = expiresAt - (this.options.now?.() ?? Date.now())
    const delay = untilExpiry > 0 ? untilExpiry + PRESENCE_AFTER_EXPIRY_MS : PRESENCE_PAST_EXPIRY_RETRY_MS
    chat.timer = setTimeout(() => {
      chat.timer = null
      this.request(chatId)
    }, Math.min(delay, MAX_TIMER_MS))
  }

  /** Stops the chat's timer and request; nobody is looking. */
  private idle(chat: ChatPresence): void {
    this.clearTimer(chat)
    chat.request?.abort()
    chat.request = null
  }

  private clearTimer(chat: ChatPresence): void {
    if (chat.timer) clearTimeout(chat.timer)
    chat.timer = null
  }

  private notify(chat: ChatPresence): void {
    for (const listener of [...chat.listeners]) listener()
  }

  private watchForeground(): void {
    const source = this.options.foreground
    if (!source) return
    const watched = [...this.chats.values()].some((chat) => chat.listeners.size > 0)
    if (watched && !this.unsubscribeForeground) {
      this.foreground = source.isForeground()
      this.unsubscribeForeground = source.subscribe((foreground) => this.setForeground(foreground))
    } else if (!watched && this.unsubscribeForeground) {
      this.unsubscribeForeground()
      this.unsubscribeForeground = null
    }
  }

  private setForeground(foreground: boolean): void {
    if (foreground === this.foreground) return
    this.foreground = foreground
    for (const [chatId, chat] of this.chats) {
      if (!foreground) this.idle(chat)
      else if (chat.listeners.size) this.request(chatId)
    }
  }
}
