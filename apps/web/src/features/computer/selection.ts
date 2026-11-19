import { COMPUTER_ACCESS_MODES, COMPUTER_PATH_MAX_LENGTH, type ComputerAccess, type ComputerFolder } from '@pulpo/contracts'
import { useSyncExternalStore } from 'react'

/**
 * What the user chose for This computer in the agent menu: off, or on with an access mode and a
 * folder. It names folders on this device only, so it stays in this device's storage, per signed-in
 * instance + account, and is never synced or part of the shared composer state. New chats start
 * from the last choice made here; a chat keeps its own once it has one.
 */
export interface ComputerChoice {
  enabled: boolean
  access: ComputerAccess
  folder: ComputerFolder | null
}

export const DEFAULT_COMPUTER_CHOICE: ComputerChoice = { enabled: false, access: 'suggest', folder: null }

interface StoredChoices {
  last: ComputerChoice
  chats: Record<string, ComputerChoice>
}

const VERSION = 1
const PREFIX = 'pulpo.computer.selection:'
/** Chats remembered at most; the least recently chosen are forgotten first. */
const MAX_CHATS = 300
const EMPTY: StoredChoices = { last: DEFAULT_COMPUTER_CHOICE, chats: {} }

/** The storage key of one account's choices (`owner` is `runtimeAccountKey`, so it names the instance too). */
export function computerSelectionStorageKey(owner: string): string {
  return `${PREFIX}${owner}`
}

function readChoice(value: unknown): ComputerChoice | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Record<string, unknown>
  if (!COMPUTER_ACCESS_MODES.includes(candidate.access as ComputerAccess)) return null
  const folder = candidate.folder as Record<string, unknown> | null | undefined
  const validFolder = folder && typeof folder.path === 'string' && typeof folder.name === 'string'
    && folder.path.length > 0 && folder.path.length <= COMPUTER_PATH_MAX_LENGTH && folder.name.length <= 1024
    ? { path: folder.path, name: folder.name } : null
  return { enabled: candidate.enabled === true, access: candidate.access as ComputerAccess, folder: validFolder }
}

export function parseComputerChoices(raw: string | null): StoredChoices {
  if (!raw) return EMPTY
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return EMPTY }
  if (!parsed || typeof parsed !== 'object' || (parsed as { v?: unknown }).v !== VERSION) return EMPTY
  const stored = parsed as { last?: unknown; chats?: unknown }
  const chats: Record<string, ComputerChoice> = {}
  if (stored.chats && typeof stored.chats === 'object') {
    for (const [chatId, value] of Object.entries(stored.chats as Record<string, unknown>).slice(-MAX_CHATS)) {
      const choice = readChoice(value)
      if (choice && chatId.length <= 64) chats[chatId] = choice
    }
  }
  return { last: readChoice(stored.last) ?? DEFAULT_COMPUTER_CHOICE, chats }
}

function localStore(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

const cache = new Map<string, StoredChoices>()
const listeners = new Set<() => void>()

function stored(owner: string): StoredChoices {
  const cached = cache.get(owner)
  if (cached) return cached
  let raw: string | null = null
  try { raw = localStore()?.getItem(computerSelectionStorageKey(owner)) ?? null } catch { /* storage is optional */ }
  const choices = parseComputerChoices(raw)
  cache.set(owner, choices)
  return choices
}

function write(owner: string, next: StoredChoices): void {
  cache.set(owner, next)
  try {
    localStore()?.setItem(computerSelectionStorageKey(owner), JSON.stringify({ v: VERSION, ...next }))
  } catch { /* storage is optional: the choice still holds until reload */ }
  for (const listener of listeners) listener()
}

function withChat(chats: Record<string, ComputerChoice>, chatId: string, choice: ComputerChoice): Record<string, ComputerChoice> {
  // Re-inserting keeps the most recently chosen last, so trimming drops the oldest.
  const { [chatId]: _previous, ...rest } = chats
  const entries = Object.entries({ ...rest, [chatId]: choice })
  return Object.fromEntries(entries.slice(-MAX_CHATS))
}

/** The choice for a chat, or for a new chat when `chatId` is null. */
export function computerChoice(owner: string, chatId: string | null): ComputerChoice {
  const choices = stored(owner)
  return (chatId ? choices.chats[chatId] : undefined) ?? choices.last
}

/** Records a choice the user made; it also becomes where new chats start. */
export function chooseComputer(owner: string, chatId: string | null, choice: ComputerChoice): void {
  const choices = stored(owner)
  write(owner, { last: choice, chats: chatId ? withChat(choices.chats, chatId, choice) : choices.chats })
}

/** Gives a chat the choice it was sent with, unless it already has its own. */
export function keepComputerChoice(owner: string, chatId: string, choice: ComputerChoice): void {
  const choices = stored(owner)
  if (choices.chats[chatId]) return
  write(owner, { ...choices, chats: withChat(choices.chats, chatId, choice) })
}

export function subscribeComputerChoices(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The current choice for a chat (or a new chat), following changes. */
export function useComputerChoice(owner: string | null, chatId: string | null): ComputerChoice {
  return useSyncExternalStore(subscribeComputerChoices, () => owner ? computerChoice(owner, chatId) : DEFAULT_COMPUTER_CHOICE)
}

/** Test hook: forgets what was read from storage. */
export function resetComputerChoicesForTests(): void {
  cache.clear()
}
