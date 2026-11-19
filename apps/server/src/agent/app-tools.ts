import { COMPUTER_APP_TYPE_MAX_CHARACTERS, type ComputerApp, type ComputerAppActionInput, type ComputerAppElement, type ComputerDescription, type ToolImagePreview } from '@pulpo/contracts'
import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { ComputerAppView, ComputerWorkspace } from './computer-workspace.js'

/**
 * The app tools: seeing and working in other apps' windows on the user's own computer ("This
 * computer", full access, on desktop apps that describe `apps`). Every tool but `app_list` answers
 * with the window as it is afterwards: its picture and a numbered list of what is in it.
 */

export const APP_TOOL_NAMES = ['app_list', 'app_view', 'app_click', 'app_type', 'app_key', 'app_scroll', 'app_drag', 'app_set_value'] as const
export type AppToolName = typeof APP_TOOL_NAMES[number]

export function isAppTool(name: string | undefined): name is AppToolName {
  return (APP_TOOL_NAMES as readonly string[]).includes(name ?? '')
}

/** Tools whose result carries a picture the agent looked at: a file's (`view_image`), or an app window's. */
export function toolShowsImage(name: string | undefined): boolean {
  return name === 'view_image' || (isAppTool(name) && name !== 'app_list')
}

/** The most characters of element list one result carries; a window with more is cut and says so. */
const ELEMENTS_MAX_CHARACTERS = 30_000
const MAX_INDENT = 8
/** Lines a scroll moves when the agent does not say. */
const DEFAULT_SCROLL_LINES = 5

const OS_NAMES: Record<ComputerDescription['os'], string> = { macos: 'Mac', windows: 'Windows computer', linux: 'Linux computer' }

function elementLine(element: ComputerAppElement): string {
  const parts = [`${'  '.repeat(Math.min(element.depth, MAX_INDENT))}[${element.index}] ${element.role}`]
  if (element.label) parts.push(JSON.stringify(element.label))
  if (element.value) parts.push(`= ${JSON.stringify(element.value)}`)
  if (element.focused) parts.push('(focused)')
  if (element.enabled === false) parts.push('(disabled)')
  parts.push(`(${element.x},${element.y} ${element.width}×${element.height})`)
  return parts.join(' ')
}

/** A window as the agent reads it, beside its picture. */
export function formatAppView(view: ComputerAppView): string {
  const { state, image } = view
  const lines = [`${state.app}, window ${JSON.stringify(state.window)}`]
  if (state.note) lines.push(state.note)
  const others = (state.windows ?? []).filter((title) => title !== state.window)
  if (others.length) lines.push(`Other windows of ${state.app}: ${others.map((title) => JSON.stringify(title)).join(', ')}`)
  lines.push(`The picture is ${image.width}×${image.height} pixels. Coordinates, and the boxes below (x,y width×height), are in its pixels from the top-left corner.`)
  if (!state.elements.length) {
    lines.push('This window lists no elements; use coordinates from the picture.')
    return lines.join('\n')
  }
  lines.push('', 'Elements:')
  let used = 0
  let listed = 0
  for (const element of state.elements) {
    const line = elementLine(element)
    if (used + line.length > ELEMENTS_MAX_CHARACTERS) break
    lines.push(line)
    used += line.length + 1
    listed += 1
  }
  if (state.truncated || listed < state.elements.length) lines.push('More elements were left out. For anything not listed, use coordinates from the picture.')
  return lines.join('\n')
}

export function formatAppList(apps: ComputerApp[]): string {
  if (!apps.length) return 'No app is running with a window open.'
  return [
    'Apps running with a window open:',
    ...apps.map((app) => {
      const notes = [...(app.allowed ? ['allowed'] : []), ...(app.frontmost ? ['the user is working in it'] : [])]
      const windows = app.windows.length ? `: ${app.windows.map((title) => JSON.stringify(title)).join(', ')}` : ''
      return `- ${app.name}${notes.length ? ` (${notes.join('; ')})` : ''}${windows}`
    }),
    apps.every((app) => app.allowed)
      ? 'The user allowed you to use all of these.'
      : 'The user is asked on their computer the first time you use an app not marked allowed.',
  ].join('\n')
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const optionalNumber = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined
const optionalInteger = (value: unknown): number | undefined => { const number = optionalNumber(value); return number === undefined ? undefined : Math.round(number) }

function target(args: Record<string, unknown>): { app: string; window?: string } {
  const app = typeof args.app === 'string' ? args.app.trim() : ''
  if (!app) throw new Error('app must name the app to use, as app_list shows it')
  const window = typeof args.window === 'string' && args.window.trim() ? args.window.trim() : undefined
  return { app, ...(window ? { window } : {}) }
}

/** Either an element or a point; the computer refuses an action with neither where one is needed. */
function place(args: Record<string, unknown>): { element?: number; x?: number; y?: number } {
  const element = optionalInteger(args.element); const x = optionalNumber(args.x); const y = optionalNumber(args.y)
  if (element !== undefined) return { element }
  if ((x === undefined) !== (y === undefined)) throw new Error('Give both x and y, or an element number')
  return x === undefined ? {} : { x, y }
}

export function createAppTools(
  manager: Pick<ComputerWorkspace, 'listApps' | 'useApp'>,
  computer: ComputerDescription,
  onOperationStarted?: (operationId: string) => void | Promise<void>,
  /** Stores the window's picture for the reply's timeline; failing costs only the preview. */
  onImagePreview?: (operationId: string, name: string, data: string) => Promise<ToolImagePreview>,
): AgentTool[] {
  const machine = `the user's ${OS_NAMES[computer.os]}`
  const background = computer.apps?.background === true
  const tool = (name: AppToolName, description: string, parameters: ReturnType<typeof Type.Object>, execute: AgentTool['execute']): AgentTool => ({ name, label: name, description, parameters, executionMode: 'sequential', execute })
  const started = (operationId: string) => () => onOperationStarted?.(operationId)
  const app = Type.String({ description: 'The app\'s name as app_list shows it, for example "TextEdit".' })
  const window = Type.Optional(Type.String({ description: 'Part of the title of the window to use when the app has several. Left out, app_view shows the front window and the other tools act in the window you were last shown.' }))
  const element = Type.Optional(Type.Integer({ minimum: 1, description: 'The number of an element in the last result for this window. Prefer it to coordinates.' }))
  const x = Type.Optional(Type.Number({ minimum: 0, description: 'Pixels from the left edge of the last picture of this window.' }))
  const y = Type.Optional(Type.Number({ minimum: 0, description: 'Pixels from the top edge of the last picture of this window.' }))
  const shown = 'Answers with the window as it is afterwards: its picture and its numbered elements.'

  const act = (name: Exclude<AppToolName, 'app_list'>, description: string, parameters: ReturnType<typeof Type.Object>, action: (args: Record<string, unknown>) => ComputerAppActionInput) => tool(name, description, parameters, async (id, rawArgs, signal) => {
    const args = record(rawArgs)
    const where = target(args)
    const view = await manager.useApp({ ...where, action: action(args) }, signal, started(id))
    let imagePreview: ToolImagePreview | undefined
    if (onImagePreview) {
      try {
        imagePreview = await onImagePreview(id, `${view.state.app}.jpg`, view.image.data)
      } catch (error) {
        console.warn('App window preview unavailable', { operationId: id, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return {
      content: [
        { type: 'text' as const, text: formatAppView(view) },
        { type: 'image' as const, data: view.image.data, mimeType: view.image.mimeType },
      ],
      details: { app: view.state.app, window: view.state.window, ...(imagePreview ? { imagePreview } : {}) },
    }
  })

  return [
    tool('app_list', `List the apps running on ${machine} with a window open, whether the user already allowed you to use each, and the window titles of the ones they allowed.`, Type.Object({}), async (id, _args, signal) => {
      const apps = await manager.listApps(signal, started(id))
      return { content: [{ type: 'text' as const, text: formatAppList(apps) }], details: { apps: apps.length } }
    }),
    act('app_view', `Look at one window of an app on ${machine}: a picture of that window alone and a numbered list of what is in it (buttons, fields, text, with their boxes). The first time you use an app, the user is asked on their computer whether you may; the tool waits for their answer. ${background ? 'Looking does not disturb the user: nothing is brought to the front.' : 'A window that is covered or minimized may be brought to the front to be seen.'}`,
      Type.Object({ app, window }), () => ({ type: 'view' })),
    act('app_click', `Click in an app's window on ${machine}: on a numbered element from the last result for that window, or at x,y in its last picture. ${shown}`,
      Type.Object({
        app, window, element, x, y,
        button: Type.Optional(Type.Union([Type.Literal('left'), Type.Literal('right'), Type.Literal('middle')], { description: 'Defaults to left.' })),
        count: Type.Optional(Type.Integer({ minimum: 1, maximum: 3, description: '2 for a double click, 3 for a triple click. Defaults to 1.' })),
      }),
      (args) => {
        const where = place(args)
        if (where.element === undefined && where.x === undefined) throw new Error('Name an element, or give x and y')
        const count = optionalInteger(args.count)
        return {
          type: 'click', ...where,
          ...(args.button === 'right' || args.button === 'middle' ? { button: args.button } : {}),
          ...(count === 2 || count === 3 ? { count } : {}),
        }
      }),
    act('app_type', `Type text into whatever has the keyboard focus in an app's window on ${machine} (click a field first to focus it). For Enter, Tab, arrows and shortcuts use app_key; to replace a field's whole contents, app_set_value is faster. ${shown}`,
      Type.Object({ app, window, text: Type.String({ description: `The text to type, at most ${COMPUTER_APP_TYPE_MAX_CHARACTERS.toLocaleString('en-US')} characters; type longer text in several calls.` }) }),
      (args) => {
        const text = String(args.text ?? '')
        if (!text) throw new Error('text must not be empty')
        if (text.length > COMPUTER_APP_TYPE_MAX_CHARACTERS) throw new Error(`text is ${text.length.toLocaleString('en-US')} characters; type at most ${COMPUTER_APP_TYPE_MAX_CHARACTERS.toLocaleString('en-US')} at a time`)
        return { type: 'type', text }
      }),
    act('app_key', `Press one key or shortcut in an app's window on ${machine}: enter, escape, tab, space, backspace, delete, up, down, left, right, home, end, pageup, pagedown, f1 to f12 or a single character, with any of ${computer.os === 'macos' ? 'cmd, ctrl, alt, shift' : 'ctrl, alt, shift, cmd (the Windows key)'} joined by "+", for example "${computer.os === 'macos' ? 'cmd+s' : 'ctrl+s'}". ${shown}`,
      Type.Object({ app, window, keys: Type.String({ description: 'One key or chord, for example "enter" or "ctrl+shift+t".' }) }),
      (args) => ({ type: 'key', keys: String(args.keys ?? '').trim() })),
    act('app_scroll', `Scroll in an app's window on ${machine}: at a numbered element, at x,y, or in the middle of the window. ${shown}`,
      Type.Object({
        app, window, element, x, y,
        direction: Type.Union([Type.Literal('up'), Type.Literal('down'), Type.Literal('left'), Type.Literal('right')], { description: 'Where to move in the content: "down" shows what is further down the page.' }),
        amount: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: `Lines to scroll. Defaults to ${DEFAULT_SCROLL_LINES}.` })),
      }),
      (args) => {
        const amount = Math.min(Math.max(optionalInteger(args.amount) ?? DEFAULT_SCROLL_LINES, 1), 100)
        const direction = String(args.direction ?? '')
        if (!['up', 'down', 'left', 'right'].includes(direction)) throw new Error('direction must be up, down, left or right')
        return {
          type: 'scroll', ...place(args),
          dx: direction === 'right' ? amount : direction === 'left' ? -amount : 0,
          dy: direction === 'down' ? amount : direction === 'up' ? -amount : 0,
        }
      }),
    act('app_drag', `Drag with the left button in an app's window on ${machine}, from one point of its last picture to another. ${shown}`,
      Type.Object({
        app, window,
        from_x: Type.Number({ minimum: 0 }), from_y: Type.Number({ minimum: 0 }),
        to_x: Type.Number({ minimum: 0 }), to_y: Type.Number({ minimum: 0 }),
      }),
      (args) => {
        const [fromX, fromY, toX, toY] = [args.from_x, args.from_y, args.to_x, args.to_y].map(optionalNumber)
        if (fromX === undefined || fromY === undefined || toX === undefined || toY === undefined) throw new Error('from_x, from_y, to_x and to_y must be numbers')
        return { type: 'drag', fromX, fromY, toX, toY }
      }),
    act('app_set_value', `Set what a numbered element in an app's window on ${machine} holds, without typing: a text field's whole text, a slider's number. Faster and surer than app_type for replacing a field's contents. ${shown}`,
      Type.Object({ app, window, element: Type.Integer({ minimum: 1, description: 'The element\'s number in the last result for this window.' }), value: Type.String() }),
      (args) => {
        const index = optionalInteger(args.element)
        if (index === undefined) throw new Error('element must be the number of an element')
        return { type: 'set_value', element: index, value: String(args.value ?? '') }
      }),
  ]
}
