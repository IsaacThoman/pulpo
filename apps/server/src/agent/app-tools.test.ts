import { describe, expect, it, vi } from 'vitest'
import type { ComputerDescription } from '@pulpo/contracts'
import { APP_TOOL_NAMES, createAppTools, formatAppList, formatAppView, isAppTool, toolShowsImage } from './app-tools.js'
import type { ComputerAppView } from './computer-workspace.js'

const mac: ComputerDescription = {
  os: 'macos', osVersion: 'macOS 15.1', arch: 'arm64', shell: 'zsh', home: '/Users/ada', cwd: '/Users/ada/Pulpo',
  attachmentsDir: '/Users/ada/a', apps: { version: 1, background: true },
}
const windows: ComputerDescription = { ...mac, os: 'windows', shell: 'pwsh', apps: { version: 1, background: false } }

const view = (extra: Partial<ComputerAppView['state']> = {}): ComputerAppView => ({
  state: {
    app: 'TextEdit', window: 'Notes.txt', truncated: false,
    elements: [
      { index: 1, depth: 0, role: 'toolbar', x: 0, y: 28, width: 800, height: 40 },
      { index: 2, depth: 1, role: 'button', label: 'Save', x: 10, y: 34, width: 60, height: 24, enabled: false },
      { index: 3, depth: 0, role: 'textarea', value: 'say "hi"', x: 0, y: 68, width: 800, height: 532, focused: true },
    ],
    ...extra,
  },
  image: { data: 'aW1hZ2U=', mimeType: 'image/jpeg', sizeBytes: 5, width: 800, height: 600 },
})

function tools(computer = mac, shown = view()) {
  const useApp = vi.fn(async () => shown)
  const listApps = vi.fn(async () => [
    { name: 'TextEdit', allowed: true, frontmost: false, windows: ['Notes.txt', 'Untitled'] },
    { name: 'Safari', allowed: false, frontmost: true, windows: [] },
  ])
  const started = vi.fn()
  const preview = vi.fn(async () => ({ attachmentId: '00000000-0000-4000-8000-000000000009', name: 'TextEdit.jpg.webp', mimeType: 'image/webp' as const, sizeBytes: 3 }))
  const all = createAppTools({ useApp, listApps }, computer, started, preview)
  const run = (name: string, args: Record<string, unknown>) => all.find((tool) => tool.name === name)!.execute(`call-${name}`, args)
  return { all, run, useApp, listApps, started, preview }
}

describe('app tools', () => {
  it('are the eight tools, each naming the computer it works on', () => {
    const { all } = tools()
    expect(all.map((tool) => tool.name)).toEqual([...APP_TOOL_NAMES])
    for (const tool of all) expect(tool.description).toContain('the user\'s Mac')
    expect(tools(windows).all.find((tool) => tool.name === 'app_key')!.description).toContain('ctrl+s')
    expect(all.find((tool) => tool.name === 'app_view')!.description).toContain('nothing is brought to the front')
    expect(tools(windows).all.find((tool) => tool.name === 'app_view')!.description).toContain('may be brought to the front')
  })

  it('know which tools show the agent a picture', () => {
    expect(isAppTool('app_click')).toBe(true)
    expect(isAppTool('bash')).toBe(false)
    expect(toolShowsImage('view_image')).toBe(true)
    expect(toolShowsImage('app_view')).toBe(true)
    expect(toolShowsImage('app_type')).toBe(true)
    expect(toolShowsImage('app_list')).toBe(false)
    expect(toolShowsImage('generate_image')).toBe(false)
    expect(toolShowsImage(undefined)).toBe(false)
  })

  it('lists apps with what the user allowed', async () => {
    const { run, listApps, started } = tools()
    const result = await run('app_list', {})
    expect(result.content).toEqual([{ type: 'text', text: [
      'Apps running with a window open:',
      '- TextEdit (allowed): "Notes.txt", "Untitled"',
      '- Safari (the user is working in it)',
      'The user is asked on their computer the first time you use an app not marked allowed.',
    ].join('\n') }])
    // The workspace says when the computer was reached; the tool hands it the way to report that.
    const onStarted = (listApps.mock.calls[0] as unknown as [undefined, () => void])[1]
    onStarted()
    expect(started).toHaveBeenCalledWith('call-app_list')
    expect(formatAppList([])).toBe('No app is running with a window open.')
    expect(formatAppList([{ name: 'Notes', allowed: true, frontmost: false, windows: [] }])).toBe('Apps running with a window open:\n- Notes (allowed)\nThe user allowed you to use all of these.')
  })

  it('shows a window as its picture and a numbered list, and keeps a preview for the timeline', async () => {
    const { run, useApp, preview } = tools()
    const result = await run('app_view', { app: ' TextEdit ', window: 'Notes' })
    expect(useApp).toHaveBeenCalledWith({ app: 'TextEdit', window: 'Notes', action: { type: 'view' } }, undefined, expect.any(Function))
    expect(result.content).toEqual([
      { type: 'text', text: [
        'TextEdit, window "Notes.txt"',
        'The picture is 800×600 pixels. Coordinates, and the boxes below (x,y width×height), are in its pixels from the top-left corner.',
        '',
        'Elements:',
        '[1] toolbar (0,28 800×40)',
        '  [2] button "Save" (disabled) (10,34 60×24)',
        '[3] textarea = "say \\"hi\\"" (focused) (0,68 800×532)',
      ].join('\n') },
      { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/jpeg' },
    ])
    expect(preview).toHaveBeenCalledWith('call-app_view', 'TextEdit.jpg', 'aW1hZ2U=')
    expect(result.details).toEqual({ app: 'TextEdit', window: 'Notes.txt', imagePreview: expect.objectContaining({ mimeType: 'image/webp' }) })
  })

  it('says what an action did, what else is open, and when the list was cut', () => {
    const text = formatAppView(view({ note: 'Pressed the Save button. A window opened: "Save".', windows: ['Save', 'Notes.txt'], window: 'Save', truncated: true }))
    expect(text.split('\n').slice(0, 3)).toEqual([
      'TextEdit, window "Save"',
      'Pressed the Save button. A window opened: "Save".',
      'Other windows of TextEdit: "Notes.txt"',
    ])
    expect(text).toMatch(/More elements were left out\. For anything not listed, use coordinates from the picture\.$/)
    expect(formatAppView(view({ elements: [] }))).toContain('This window lists no elements; use coordinates from the picture.')
    const many = Array.from({ length: 1_000 }, (_, index) => ({ index: index + 1, depth: 0, role: 'text', label: 'x'.repeat(150), x: 0, y: 0, width: 1, height: 1 }))
    expect(formatAppView(view({ elements: many })).length).toBeLessThan(32_000)
  })

  it('turns each tool\'s arguments into one action', async () => {
    const { run, useApp } = tools()
    const sent = () => (useApp.mock.calls.at(-1) as unknown as [{ action: unknown }])[0].action
    await run('app_click', { app: 'TextEdit', element: 2 })
    expect(sent()).toEqual({ type: 'click', element: 2 })
    await run('app_click', { app: 'TextEdit', x: 12.5, y: 40, button: 'right', count: 2 })
    expect(sent()).toEqual({ type: 'click', x: 12.5, y: 40, button: 'right', count: 2 })
    await run('app_type', { app: 'TextEdit', text: 'hello' })
    expect(sent()).toEqual({ type: 'type', text: 'hello' })
    await run('app_key', { app: 'TextEdit', keys: ' cmd+s ' })
    expect(sent()).toEqual({ type: 'key', keys: 'cmd+s' })
    await run('app_scroll', { app: 'TextEdit', direction: 'down' })
    expect(sent()).toEqual({ type: 'scroll', dx: 0, dy: 5 })
    await run('app_scroll', { app: 'TextEdit', element: 3, direction: 'left', amount: 2 })
    expect(sent()).toEqual({ type: 'scroll', element: 3, dx: -2, dy: 0 })
    await run('app_drag', { app: 'TextEdit', from_x: 1, from_y: 2, to_x: 30, to_y: 40 })
    expect(sent()).toEqual({ type: 'drag', fromX: 1, fromY: 2, toX: 30, toY: 40 })
    await run('app_set_value', { app: 'TextEdit', element: 3, value: '' })
    expect(sent()).toEqual({ type: 'set_value', element: 3, value: '' })
  })

  it('refuses arguments that name no app or no place before the computer is asked', async () => {
    const { run, useApp } = tools()
    await expect(run('app_view', {})).rejects.toThrow('app must name the app')
    await expect(run('app_click', { app: 'TextEdit' })).rejects.toThrow('Name an element, or give x and y')
    await expect(run('app_click', { app: 'TextEdit', x: 3 })).rejects.toThrow('Give both x and y')
    await expect(run('app_type', { app: 'TextEdit', text: '' })).rejects.toThrow('text must not be empty')
    await expect(run('app_type', { app: 'TextEdit', text: 'x'.repeat(2_001) })).rejects.toThrow('type at most 2,000 at a time')
    await expect(run('app_scroll', { app: 'TextEdit', direction: 'sideways' })).rejects.toThrow('direction must be')
    await expect(run('app_drag', { app: 'TextEdit', from_x: 1 })).rejects.toThrow('must be numbers')
    await expect(run('app_set_value', { app: 'TextEdit', value: 'x' })).rejects.toThrow('element must be')
    expect(useApp).not.toHaveBeenCalled()
  })

  it('still shows the window when its preview cannot be stored', async () => {
    const { all, useApp } = tools()
    const failing = createAppTools({ useApp, listApps: vi.fn() }, mac, undefined, async () => { throw new Error('storage is down') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const result = await failing.find((tool) => tool.name === 'app_view')!.execute('call-1', { app: 'TextEdit' })
    expect(result.content).toHaveLength(2)
    expect(result.details).toEqual({ app: 'TextEdit', window: 'Notes.txt' })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
    expect(all).toHaveLength(8)
  })
})
