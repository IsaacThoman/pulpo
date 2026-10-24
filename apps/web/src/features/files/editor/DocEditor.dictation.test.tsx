// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { ydocToMarkdown } from '@pulpo/client-core/doc-schema'
import type { Editor } from '@tiptap/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { PulpoSocket } from '@/lib/realtime-socket'
import { DocEditor } from './DocEditor'
import { FakeServer, FakeSocket } from './fake-doc-server.test.helpers'
import { SocketIOYProvider } from './socket-provider'

// jsdom has no layout; scrolling the cursor into view measures it.
const rect = { top: 0, bottom: 10, left: 0, right: 10, width: 10, height: 10, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
Range.prototype.getBoundingClientRect = () => rect
Range.prototype.getClientRects = () => Object.assign([rect], { item: () => rect }) as unknown as DOMRectList
Element.prototype.getClientRects = () => Object.assign([rect], { item: () => rect }) as unknown as DOMRectList
window.scrollBy = () => undefined

/** What clicking into the text does; jsdom does not focus editable content by itself. */
function place(editor: Editor, selection: number | { from: number; to: number }) {
  editor.commands.setTextSelection(selection)
  fireEvent.focus(editor.view.dom)
}

const media = {
  tracks: [] as Array<{ stop: ReturnType<typeof vi.fn> }>,
  transcriptions: 0,
  transcript: 'brave new',
}

class FakeMediaRecorder {
  static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus'
  state: RecordingState = 'inactive'
  mimeType: string
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? 'audio/webm'
  }
  start() { this.state = 'recording' }
  stop() {
    this.state = 'inactive'
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob(['voice'], { type: this.mimeType }) })
      this.onstop?.()
    }, 0)
  }
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  media.tracks.length = 0
  media.transcriptions = 0
  media.transcript = 'brave new'
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => {
        const track = { stop: vi.fn() }
        media.tracks.push(track)
        return { getTracks: () => [track] } as unknown as MediaStream
      }),
    },
  })
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (!String(input).endsWith('/api/dictation/transcriptions')) return new Response('{}', { status: 200 })
    media.transcriptions += 1
    return new Response(JSON.stringify({ text: media.transcript }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
})

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function mount({ editable = true, dictation = true } = {}) {
  const server = new FakeServer()
  const doc = new Y.Doc()
  const provider = new SocketIOYProvider('doc-1', doc)
  provider.attach(new FakeSocket(server) as unknown as PulpoSocket)
  const view = render(<TooltipProvider><DocEditor session={{ doc, provider }} editable={editable} dictation={dictation} /></TooltipProvider>)
  const editor = await waitFor(() => {
    const instance = view.container.querySelector<HTMLElement & { editor?: Editor }>('.pulpo-doc-editor')?.editor
    if (!instance) throw new Error('editor not ready')
    return instance
  })
  const bar = () => view.container.querySelector<HTMLElement>('.pulpo-doc-dictation')!
  const dictate = () => view.getByRole('button', { name: 'Dictate' })
  const recording = () => waitFor(() => expect(view.getByRole('status', { name: /^Recording / })).toBeTruthy())
  const idle = () => waitFor(() => expect(bar().dataset.active).toBe('false'))
  return { view, doc, editor, bar, dictate, recording, idle }
}

describe('DocEditor dictation', () => {
  it('records from the toolbar and types the transcript at the cursor', async () => {
    const { view, doc, editor, bar, dictate, recording, idle } = await mount()
    editor.commands.setContent('<p>hello world</p>')
    // Clicked after "hello".
    place(editor, 6)
    expect(bar().hasAttribute('inert')).toBe(true)

    fireEvent.click(dictate())
    expect(dictate().getAttribute('aria-pressed')).toBe('true')
    expect(bar().dataset.active).toBe('true')
    expect(bar().hasAttribute('inert')).toBe(false)
    await recording()

    fireEvent.click(view.getByRole('button', { name: 'Finish dictation' }))
    await waitFor(() => expect(ydocToMarkdown(doc)).toBe('hello brave new world'))
    expect(media.tracks[0]!.stop).toHaveBeenCalled()
    // The cursor follows the dictated words, before the space ahead of "world".
    expect(editor.state.selection.from).toBe(16)
    await idle()
    expect(dictate().getAttribute('aria-pressed')).toBe('false')
  })

  it('keeps the formatting at the cursor and replaces a selection', async () => {
    const { view, doc, editor, dictate, recording } = await mount()
    media.transcript = 'bold'
    editor.commands.setContent('<p>make <strong>this</strong> clear</p>')
    place(editor, { from: 6, to: 10 })
    fireEvent.click(dictate())
    await recording()
    // Pressing Dictate again finishes, like the floating bar's check.
    fireEvent.click(dictate())
    await waitFor(() => expect(ydocToMarkdown(doc)).toBe('make **bold** clear'))
    expect(view.queryByRole('alert')).toBeNull()
  })

  it('starts and finishes with the shortcut, and cancels with Escape without uploading', async () => {
    const { doc, editor, recording, idle } = await mount()
    editor.commands.setContent('<p>Notes</p>')
    place(editor, editor.state.doc.content.size - 1)
    const shortcut = { key: 'D', shiftKey: true, metaKey: true, ctrlKey: true }

    fireEvent.keyDown(editor.view.dom, shortcut)
    await recording()
    fireEvent.keyDown(editor.view.dom, { key: 'Escape' })
    await idle()
    expect(media.tracks[0]!.stop).toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(media.transcriptions).toBe(0)
    expect(ydocToMarkdown(doc)).toBe('Notes')

    fireEvent.keyDown(editor.view.dom, shortcut)
    await recording()
    fireEvent.keyDown(editor.view.dom, shortcut)
    await waitFor(() => expect(ydocToMarkdown(doc)).toBe('Notes brave new'))
  })

  it('continues the document when the cursor was never placed', async () => {
    const { view, doc, editor, recording } = await mount()
    editor.commands.setContent('<p>First</p><p>Last</p>')
    editor.commands.blur()
    fireEvent.click(view.getByRole('button', { name: 'Dictate' }))
    await recording()
    fireEvent.click(view.getByRole('button', { name: 'Finish dictation' }))
    await waitFor(() => expect(ydocToMarkdown(doc)).toBe('First\n\nLast brave new'))
  })

  it('reports a transcription with no speech and keeps the document as it was', async () => {
    const { view, doc, editor, dictate, recording, idle } = await mount()
    media.transcript = '  '
    editor.commands.setContent('<p>Notes</p>')
    fireEvent.click(dictate())
    await recording()
    fireEvent.click(view.getByRole('button', { name: 'Finish dictation' }))
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('No speech was detected in the recording'))
    await idle()
    expect(ydocToMarkdown(doc)).toBe('Notes')
    fireEvent.click(view.getByRole('button', { name: 'Dismiss' }))
    expect(view.queryByRole('alert')).toBeNull()
  })

  it('cannot dictate into a read-only document, and is hidden when dictation is off', async () => {
    const readOnly = await mount({ editable: false })
    expect(readOnly.dictate().hasAttribute('disabled')).toBe(true)
    cleanup()
    const off = await mount({ dictation: false })
    expect(off.view.queryByRole('button', { name: 'Dictate' })).toBeNull()
    expect(off.view.container.querySelector('.pulpo-doc-dictation')).toBeNull()
  })
})
