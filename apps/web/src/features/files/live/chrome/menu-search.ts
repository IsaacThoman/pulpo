import { normalizeEntries, type MenuDefinition, type MenuEntry, type MenuIcon } from './menu'
import { MENU_SEARCH_ID } from './menu-keys'
import type { ShortcutSpec } from './shortcuts'

/** One command of the menu bar, as the search lists it. */
export interface MenuCommand {
  /** Unique in the list: the ids of the menu, its submenus, and the item ("format/text/bold"). */
  key: string
  id: string
  label: string
  /** The menu and submenus it sits in ("Format", "Text"), in the current language. */
  path: string[]
  icon?: MenuIcon
  shortcut?: ShortcutSpec
  checked?: boolean
  radio?: boolean
  /** Greyed in the menu, or in a greyed submenu. */
  disabled: boolean
  destructive?: boolean
  onSelect: () => void
}

/**
 * Every command of the menus, submenus included, in menu order: the rows a person could pick.
 * Separators, labels, and custom rows (a table-size grid) are left out. Calls each menu's
 * `items()`, so call it when the search opens: state and labels are as the menus would show them.
 */
export function flattenMenus(menus: readonly MenuDefinition[]): MenuCommand[] {
  const commands: MenuCommand[] = []
  const keys = new Set<string>()
  const walk = (entries: readonly MenuEntry[], path: string[], ids: string[], disabled: boolean) => {
    for (const entry of normalizeEntries(entries)) {
      if (entry.type === 'submenu') {
        walk(entry.items, [...path, entry.label], [...ids, entry.id], disabled || Boolean(entry.disabled))
        continue
      }
      if (entry.type !== 'item' || entry.id === MENU_SEARCH_ID) continue
      const base = [...ids, entry.id].join('/')
      let key = base
      for (let copy = 2; keys.has(key); copy++) key = `${base}~${copy}`
      keys.add(key)
      commands.push({
        key,
        id: entry.id,
        label: entry.label,
        path,
        icon: entry.icon,
        shortcut: entry.shortcut,
        checked: entry.checked,
        radio: entry.radio,
        disabled: disabled || Boolean(entry.disabled),
        destructive: entry.destructive,
        onSelect: entry.onSelect,
      })
    }
  }
  for (const menu of menus) walk(menu.items(), [menu.label], [menu.id], false)
  return commands
}

/** Lower case without accents, so "negrita" finds "Negrita" and "subindice" finds "Subíndice". */
const fold = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/** The words of a label or a query: letters and digits ("Zoom ▸ 100%" is "zoom", "100"). */
const wordsOf = (text: string) => fold(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean)

const everyWord = (words: readonly string[], test: (word: string) => boolean) => words.every(test)

/**
 * How well a command matches the query's words, or 0. Best first: the label itself, a label that
 * starts with the query, every word starting a word of the label, then of the label and its menus
 * ("format bold"), then inside words, and last the letters in order ("brdrs" for "Borders").
 */
function score(command: MenuCommand, words: readonly string[]): number {
  const label = wordsOf(command.label)
  const all = [...label, ...command.path.flatMap(wordsOf)]
  const labelText = label.join(' ')
  const query = words.join(' ')
  if (labelText === query) return 1000
  if (labelText.startsWith(query)) return 900
  const startsLabelWord = (word: string) => label.some((part) => part.startsWith(word))
  if (everyWord(words, startsLabelWord)) {
    // Earlier words first: "line" finds "Line numbers" before "Insert horizontal line".
    const first = label.findIndex((part) => part.startsWith(words[0]!))
    return 800 - Math.min(first, 50)
  }
  const startsAnyWord = (word: string) => all.some((part) => part.startsWith(word))
  if (everyWord(words, startsAnyWord)) return words.some(startsLabelWord) ? 600 : 500
  // A single letter inside a word ("i" in "Print") matches nearly everything.
  if (words.some((word) => word.length < 2)) return 0
  if (everyWord(words, (word) => labelText.includes(word))) return 400
  if (everyWord(words, (word) => all.some((part) => part.includes(word)))) return 300
  return fuzzy(labelText, words.join(''))
}

/**
 * The query's letters in order in the label, the first at the start of a word, scored by how
 * close together they are; 0 when they are not there. Short queries never match this way.
 */
function fuzzy(label: string, query: string): number {
  if (query.length < 3) return 0
  let best = 0
  for (let start = label.indexOf(query[0]!); start >= 0; start = label.indexOf(query[0]!, start + 1)) {
    if (start > 0 && label[start - 1] !== ' ') continue
    let at = start
    for (let index = 1; index < query.length && at >= 0; index++) at = label.indexOf(query[index]!, at + 1)
    if (at < 0) break
    best = Math.max(best, 100 + Math.round((100 * query.length) / (at - start + 1)))
  }
  return best
}

/**
 * The commands matching `query`, best first; with no query, all of them in menu order. A tie
 * keeps menu order, with commands that cannot run now after those that can.
 */
export function searchMenuCommands(commands: readonly MenuCommand[], query: string): MenuCommand[] {
  const words = wordsOf(query)
  if (!words.length) {
    // Only punctuation ("%"): look for it as written.
    const raw = fold(query.trim())
    return raw ? commands.filter((command) => fold(command.label).includes(raw)) : [...commands]
  }
  return commands
    .map((command, order) => ({ command, order, score: score(command, words) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || Number(a.command.disabled) - Number(b.command.disabled) || a.order - b.order)
    .map((match) => match.command)
}
