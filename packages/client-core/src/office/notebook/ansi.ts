/**
 * ANSI escape sequences in terminal output (tracebacks, colored logs) parsed into styled runs of
 * plain text. Only SGR styling is kept; cursor movement, titles, hyperlinks, and every other
 * control sequence are dropped, so the text can be rendered safely as text nodes.
 */

/** The 16 basic colors by name, so each client maps them to its own theme. */
export type AnsiNamedColor =
  | 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white'
  | 'bright-black' | 'bright-red' | 'bright-green' | 'bright-yellow' | 'bright-blue' | 'bright-magenta' | 'bright-cyan' | 'bright-white'

/** A named color, or `#rrggbb` for 256-color and true-color codes. */
export type AnsiColor = AnsiNamedColor | `#${string}`

export interface AnsiStyle {
  fg?: AnsiColor
  bg?: AnsiColor
  bold?: boolean
  dim?: boolean
  italic?: boolean
  underline?: boolean
}

export interface AnsiSegment {
  text: string
  style: AnsiStyle
}

const NAMES: readonly AnsiNamedColor[] = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
const BRIGHT: readonly AnsiNamedColor[] = NAMES.map((name) => `bright-${name}` as AnsiNamedColor)

function hex(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0')
}

/** The xterm 256-color palette: 16 basic colors, a 6×6×6 cube, then 24 grays. */
function color256(index: number): AnsiColor | undefined {
  if (!Number.isInteger(index) || index < 0 || index > 255) return undefined
  if (index < 8) return NAMES[index]
  if (index < 16) return BRIGHT[index - 8]
  if (index < 232) {
    const cube = index - 16
    const level = (step: number) => (step === 0 ? 0 : 55 + step * 40)
    return `#${hex(level(Math.floor(cube / 36)))}${hex(level(Math.floor(cube / 6) % 6))}${hex(level(cube % 6))}`
  }
  const gray = 8 + (index - 232) * 10
  return `#${hex(gray)}${hex(gray)}${hex(gray)}`
}

/** Applies one SGR parameter list to a style, returning the new style. */
function applySgr(style: AnsiStyle, parameters: number[]): AnsiStyle {
  const next = { ...style }
  for (let index = 0; index < parameters.length; index += 1) {
    const code = parameters[index]!
    if (code === 0) {
      for (const key of Object.keys(next) as (keyof AnsiStyle)[]) delete next[key]
    } else if (code === 1) next.bold = true
    else if (code === 2) next.dim = true
    else if (code === 3) next.italic = true
    else if (code === 4) next.underline = true
    else if (code === 22) {
      delete next.bold
      delete next.dim
    } else if (code === 23) delete next.italic
    else if (code === 24) delete next.underline
    else if (code >= 30 && code <= 37) next.fg = NAMES[code - 30]
    else if (code === 39) delete next.fg
    else if (code >= 40 && code <= 47) next.bg = NAMES[code - 40]
    else if (code === 49) delete next.bg
    else if (code >= 90 && code <= 97) next.fg = BRIGHT[code - 90]
    else if (code >= 100 && code <= 107) next.bg = BRIGHT[code - 100]
    else if (code === 38 || code === 48) {
      const mode = parameters[index + 1]
      let color: AnsiColor | undefined
      if (mode === 5) {
        color = color256(parameters[index + 2] ?? -1)
        index += 2
      } else if (mode === 2) {
        const [red, green, blue] = [parameters[index + 2], parameters[index + 3], parameters[index + 4]]
        if (red !== undefined && green !== undefined && blue !== undefined) color = `#${hex(red)}${hex(green)}${hex(blue)}`
        index += 4
      }
      if (color) {
        if (code === 38) next.fg = color
        else next.bg = color
      }
    }
  }
  return next
}

// CSI (ESC [ … final byte), OSC (ESC ] … BEL or ST), other two-byte escapes, and stray C0 controls.
// eslint-disable-next-line no-control-regex
const ESCAPE = /\u001b\[([0-9;:?<=>]*)([ -/]*)([@-~])|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b[@-Z\\-_]?|[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/g

/** Splits text into runs of one style each, with every escape sequence removed. */
export function parseAnsi(text: string): AnsiSegment[] {
  const segments: AnsiSegment[] = []
  let style: AnsiStyle = {}
  let last = 0
  const push = (value: string) => {
    if (!value) return
    const previous = segments[segments.length - 1]
    if (previous && previous.style === style) previous.text += value
    else segments.push({ text: value, style })
  }
  for (const match of text.matchAll(ESCAPE)) {
    push(text.slice(last, match.index))
    last = match.index + match[0].length
    // Only SGR (`m`) changes how text looks; other sequences are dropped.
    if (match[3] === 'm' && !match[2]) {
      const parameters = (match[1] ?? '').split(/[;:]/).map((part) => (part === '' ? 0 : Number(part)))
      style = applySgr(style, parameters.length ? parameters : [0])
    }
  }
  push(text.slice(last))
  return segments
}

/** Text with every escape sequence removed. */
export function stripAnsi(text: string): string {
  return text.replace(ESCAPE, '')
}
