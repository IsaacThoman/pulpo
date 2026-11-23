import type { WorkspaceScreenPresence } from '@pulpo/contracts'

/**
 * Whether each chat's workspace is still there, so the reply that offers its screen knows whether
 * to show **Open screen** or **Screen closed**. Web and mobile share this; each gives it the request
 * and, where it has one, a signal for whether the app is in front.
 *
 * One record per chat, shared by everything that shows the chat: one request at a time and one
 * timer. It asks when a chat starts being watched, a moment after the workspace is due to go, when
 * a reply in the chat finishes and whenever `ask` says something changed (the viewer closed). It
 * never asks on an interval, nor while a reply is at work, nobody watches, or the app is in the
 * background. A failed request keeps the last answer.
 */

/** How long after the workspace is due to go to ask, so the server has let it go by then. */
export const PRESENCE_EXPIRY_GRACE_MS = 3_000
/**
 * The soonest to ask again when an answer's expiry has already passed here (this clock runs ahead
 * of the server's, say). It doubles each time that happens in a row, up to ten minutes.
 */
export const PRESENCE_RECHECK_MIN_MS = 30_000
const PRESENCE_RECHECK_MAX_MS = 10 * 60_000
/** The longest a timer can wait (about 24 days); later expiries are checked again then. */
const MAX_TIMER_MS = 2_147_483_647

/**
 * What the reply that offers the chat's screen shows: the button, until an answer says the
 * workspace is gone (and before any answer, since the viewer explains itself), then a note.
 */
export function workspaceScreenOffer(presence: WorkspaceScreenPresence | undefined): 'open' | 'closed' {
  return presence && !presence.live ? 'closed' : 'open'
}

/** Whether the app is in front, and changes to it. */
export interface PresenceForeground {
  isForeground: () => boolean
  subscribe: (listener: (foreground: boolean) => void) => () => void
}

export interface WorkspaceScreenPresenceOptions {
  fetchPresence: (chatId: string, signal: AbortSignal) => Promise<WorkspaceScreenPresence>
  /** Asking stops while the app is in the background and starts again when it returns. */
  foreground?: PresenceForeground
  now?: () => number
}

interface ChatPresence {
  presence: WorkspaceScreenPresence | undefined
  listeners: Set<() => void>
  /** A reply in the chat is at work, so the workspace is there without asking. */
  busy: boolean
  request: AbortController | null
  timer: ReturnType<typeof setTimeout> | null
  /** Answers in a row whose expiry had already passed here. */
  stale: number
}

export class WorkspaceScreenPresenceTracker {
  private readonly chats = new Map<string, ChatPresence>()
  private foreground = true
  private stopWatchingForeground: (() => void) | null = null

  constructor(private readonly options: WorkspaceScreenPresenceOptions) {}

  /** The chat's last answer; undefined before the first one, and while a reply is at work. */
  get(chatId: string): WorkspaceScreenPresence | undefined {
    return this.chats.get(chatId)?.presence
  }

  /** Watches the chat's answer. The first watcher of a chat asks at once. Returns how to stop. */
  subscribe(chatId: string, listener: () => void): () => void {
    const chat = this.chat(chatId)
    const first = chat.listeners.size === 0
    chat.listeners.add(listener)
    this.watchForeground()
    if (first) {
      chat.stale = 0
      this.request(chatId, chat)
    }
    return () => {
      chat.listeners.delete(listener)
      if (!chat.listeners.size) this.idle(chat)
      this.watchForeground()
    }
  }

  /** Something changed the workspace's life (the viewer closed): asks again, if the chat is watched. */
  ask(chatId: string): void {
    const chat = this.chats.get(chatId)
    if (chat) this.request(chatId, chat)
  }

  /**
   * Whether a reply in the chat is at work. While one is, nothing is asked and the answer from
   * before it is forgotten, so an old "gone" never shows; when it finishes, the chat is asked again.
   */
  setBusy(chatId: string, busy: boolean): void {
    const chat = this.chat(chatId)
    if (chat.busy === busy) return
    chat.busy = busy
    if (!busy) return this.request(chatId, chat)
    this.idle(chat)
    if (chat.presence === undefined) return
    chat.presence = undefined
    this.notify(chat)
  }

  /** Forgets every chat; for tests. */
  reset(): void {
    for (const chat of this.chats.values()) this.idle(chat)
    this.chats.clear()
    this.stopWatchingForeground?.()
    this.stopWatchingForeground = null
    this.foreground = true
  }

  private chat(chatId: string): ChatPresence {
    let chat = this.chats.get(chatId)
    if (!chat) {
      chat = { presence: undefined, listeners: new Set(), busy: false, request: null, timer: null, stale: 0 }
      this.chats.set(chatId, chat)
    }
    return chat
  }

  /** Asks now, replacing a request already out: the newest reason to ask wins. */
  private request(chatId: string, chat: ChatPresence): void {
    if (!chat.listeners.size || chat.busy || !this.foreground) return
    this.idle(chat)
    const controller = new AbortController()
    chat.request = controller
    this.options.fetchPresence(chatId, controller.signal).then((presence) => {
      if (chat.request !== controller) return
      chat.request = null
      const previous = chat.presence
      chat.presence = presence
      if (previous?.live !== presence.live || previous?.expiresAt !== presence.expiresAt) this.notify(chat)
      this.schedule(chatId, chat)
    }, () => {
      if (chat.request !== controller) return
      chat.request = null
      // The last answer stands, and so does the check after its expiry.
      this.schedule(chatId, chat)
    })
  }

  private schedule(chatId: string, chat: ChatPresence): void {
    this.clearTimer(chat)
    const presence = chat.presence
    if (!presence?.live || !presence.expiresAt || !chat.listeners.size || chat.busy || !this.foreground) return
    const expiresAt = Date.parse(presence.expiresAt)
    if (!Number.isFinite(expiresAt)) return
    const untilExpiry = expiresAt - (this.options.now?.() ?? Date.now())
    let delay = untilExpiry + PRESENCE_EXPIRY_GRACE_MS
    if (untilExpiry <= 0) {
      delay = Math.min(PRESENCE_RECHECK_MAX_MS, PRESENCE_RECHECK_MIN_MS * 2 ** chat.stale)
      chat.stale += 1
    } else chat.stale = 0
    chat.timer = setTimeout(() => {
      chat.timer = null
      this.request(chatId, chat)
    }, Math.min(delay, MAX_TIMER_MS))
  }

  /** Stops the chat's timer and request. */
  private idle(chat: ChatPresence): void {
    this.clearTimer(chat)
    chat.request?.abort()
    chat.request = null
  }

  private clearTimer(chat: ChatPresence): void {
    if (chat.timer !== null) clearTimeout(chat.timer)
    chat.timer = null
  }

  private notify(chat: ChatPresence): void {
    for (const listener of [...chat.listeners]) listener()
  }

  /** Listens to the foreground only while some chat is watched. */
  private watchForeground(): void {
    const source = this.options.foreground
    if (!source) return
    const watched = [...this.chats.values()].some((chat) => chat.listeners.size > 0)
    if (watched && !this.stopWatchingForeground) {
      this.foreground = source.isForeground()
      this.stopWatchingForeground = source.subscribe((foreground) => this.setForeground(foreground))
    } else if (!watched && this.stopWatchingForeground) {
      this.stopWatchingForeground()
      this.stopWatchingForeground = null
    }
  }

  private setForeground(foreground: boolean): void {
    if (foreground === this.foreground) return
    this.foreground = foreground
    for (const [chatId, chat] of this.chats) {
      if (foreground) this.request(chatId, chat)
      else this.idle(chat)
    }
  }
}
