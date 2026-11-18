/**
 * Commands typed at the start of a message in a saved chat. Only these exact commands are taken;
 * any other message that starts with "/" is sent as written.
 */
export type ComposerCommand =
  /** `/btw <question>`: ask in a side chat; an empty question just opens one. */
  | { kind: 'btw'; question: string }
  /** `/fork`: continue in a new chat from the active reply. */
  | { kind: 'fork' }

export type ComposerCommandName = ComposerCommand['kind']

export const COMPOSER_COMMANDS: readonly ComposerCommandName[] = ['btw', 'fork']

/** The command a message runs, or null when it is an ordinary message. */
export function parseComposerCommand(text: string, available: readonly ComposerCommandName[] = COMPOSER_COMMANDS): ComposerCommand | null {
  const trimmed = text.trim()
  const btw = /^\/btw(?:\s+([\s\S]*))?$/i.exec(trimmed)
  if (btw && available.includes('btw')) return { kind: 'btw', question: (btw[1] ?? '').trim() }
  if (/^\/fork$/i.test(trimmed) && available.includes('fork')) return { kind: 'fork' }
  return null
}

/**
 * The commands to suggest while a draft is being typed: those whose name starts with what follows
 * a leading "/", until the draft has more than the command (or `/btw` and its question).
 */
export function matchingComposerCommands(text: string, available: readonly ComposerCommandName[] = COMPOSER_COMMANDS): ComposerCommandName[] {
  const match = /^\/([a-z]*)(\s[\s\S]*)?$/i.exec(text.trimStart())
  if (!match) return []
  const typed = match[1]!.toLowerCase()
  const rest = match[2]
  return available.filter((name) => rest === undefined ? name.startsWith(typed) : name === typed && name === 'btw')
}
