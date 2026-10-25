// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { FileNode, FileRecording, RecordingClip } from '@pulpo/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAuth } from '@/stores/auth'
import { recordingQueryKey } from './api'
import { RecordingEditor } from './RecordingEditor'
import { useRecordingQuery } from './use-recording-query'
import { useTakeUploads } from './take-uploads'

vi.hoisted(() => {
  window.matchMedia = (() => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })) as never
  // Pointer events carry their coordinates in jsdom only as mouse events.
  if (typeof window.PointerEvent === 'undefined') window.PointerEvent = class extends MouseEvent {} as never
  HTMLElement.prototype.setPointerCapture = () => undefined
  HTMLElement.prototype.scrollIntoView = () => undefined
})
const api = vi.hoisted(() => ({
  updateRecordingSkips: vi.fn(),
  deleteRecordingClip: vi.fn(),
  retryRecordingTranscript: vi.fn(),
  downloadRecordingClip: vi.fn(),
  fetchRecordingClipBlob: vi.fn(),
  uploadRecordingClip: vi.fn(),
}))
vi.mock('./api', async (actual) => ({ ...await actual<object>(), ...api }))

const node = { id: '11111111-1111-4111-8111-111111111111', kind: 'recording', name: 'Standup', trashedAt: null } as FileNode

function clip(id: string, position: number, extra: Partial<RecordingClip> = {}): RecordingClip {
  return {
    id, position, mimeType: 'audio/mp4', sizeBytes: 10, durationMs: 10_000, levels: [20, 60, 40], skips: [],
    transcript: { status: 'ready', error: null, segments: [] },
    recordedAt: '2026-10-25T14:03:00.000Z', createdAt: '2026-10-25T14:03:10.000Z',
    ...extra,
  }
}

const recording: FileRecording = {
  node,
  clips: [
    clip('a', 0, {
      skips: [{ startMs: 4_000, endMs: 6_000 }],
      transcript: {
        status: 'ready', error: null,
        segments: [{ startMs: 0, endMs: 4_000, text: 'Good morning.' }, { startMs: 4_000, endMs: 6_000, text: 'Um, one sec.' }, { startMs: 6_000, endMs: 10_000, text: 'The launch is Friday.' }],
      },
    }),
    clip('b', 1, { transcript: { status: 'failed', error: 'The transcript could not be made.', segments: [] } }),
  ],
}

/** Like the file page: the editor shows what the recording's query holds. */
function Harness({ editable }: { editable: boolean }) {
  const { data } = useRecordingQuery('user', node.id)
  return data ? <RecordingEditor recording={data} editable={editable} layout="page" /> : null
}

function renderEditor(editable = true, value = recording) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(recordingQueryKey('user', node.id), value)
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <Harness editable={editable} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

function timeline() {
  const element = screen.getByTestId('recording-timeline')
  element.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 96, right: 200, bottom: 96, x: 0, y: 0, toJSON: () => undefined })
  return element
}

beforeEach(() => {
  useAuth.setState({ user: { id: 'user' }, dictationEnabled: true } as never)
  api.updateRecordingSkips.mockImplementation(async (_id: string, skips: Array<{ clipId: string; startMs: number; endMs: number }>) => ({
    ...recording,
    clips: recording.clips.map((entry) => ({ ...entry, skips: skips.filter((skip) => skip.clipId === entry.id).map(({ startMs, endMs }) => ({ startMs, endMs })) })),
  }))
  api.retryRecordingTranscript.mockResolvedValue(recording.clips[1])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  useTakeUploads.setState({ takes: [] })
})

describe('RecordingEditor', () => {
  it('shows each take with its transcript, striking out skipped lines', () => {
    renderEditor()
    const first = screen.getByRole('region', { name: 'Take 1' })
    expect(within(first).getByText('Good morning.').className).not.toContain('line-through')
    expect(within(first).getByText('Um, one sec.').className).toContain('line-through')
    expect(within(screen.getByRole('region', { name: 'Take 2' })).getByText('The transcript could not be made.')).toBeTruthy()
    expect(screen.getByText('0:18 with skips')).toBeTruthy()
    expect(screen.getAllByTestId('recording-skip')).toHaveLength(1)
  })

  it('skips and keeps transcript lines across the take they are in', async () => {
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: "Don't skip this part" }))
    expect(api.updateRecordingSkips).toHaveBeenLastCalledWith(node.id, [])
    await waitFor(() => expect(screen.getByText('Um, one sec.').className).not.toContain('line-through'))
    fireEvent.click(screen.getAllByRole('button', { name: 'Skip this part' })[0]!)
    expect(api.updateRecordingSkips).toHaveBeenLastCalledWith(node.id, [{ clipId: 'a', startMs: 0, endMs: 4_000 }])
  })

  it('selects a part by dragging across the waveform and skips it', async () => {
    renderEditor()
    const track = timeline()
    // 200 px stand for 20 s: drag from 9 s to 13 s, across the two takes.
    fireEvent.pointerDown(track, { button: 0, clientX: 90, pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: 110, pointerId: 1 })
    fireEvent.pointerMove(track, { clientX: 130, pointerId: 1 })
    fireEvent.pointerUp(track, { clientX: 130, pointerId: 1 })
    const toolbar = await screen.findByRole('toolbar', { name: 'Selected part' })
    expect(within(toolbar).getByText('0:09–0:13 selected')).toBeTruthy()
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Skip' }))
    expect(api.updateRecordingSkips).toHaveBeenLastCalledWith(node.id, [
      { clipId: 'a', startMs: 4_000, endMs: 6_000 },
      { clipId: 'a', startMs: 9_000, endMs: 10_000 },
      { clipId: 'b', startMs: 0, endMs: 3_000 },
    ])
    expect(screen.queryByRole('toolbar', { name: 'Selected part' })).toBeNull()
  })

  it('selects a skipped part when it is clicked, so it can be kept', async () => {
    renderEditor()
    const track = timeline()
    fireEvent.pointerDown(track, { button: 0, clientX: 50, pointerId: 1 })
    fireEvent.pointerUp(track, { clientX: 50, pointerId: 1 })
    const toolbar = await screen.findByRole('toolbar', { name: 'Selected part' })
    expect(within(toolbar).queryByRole('button', { name: 'Skip' })).toBeNull()
    fireEvent.click(within(toolbar).getByRole('button', { name: "Don't skip" }))
    expect(api.updateRecordingSkips).toHaveBeenLastCalledWith(node.id, [])
  })

  it('marks a skip from where playback is with S, twice', async () => {
    renderEditor()
    const track = timeline()
    fireEvent.pointerDown(track, { button: 0, clientX: 110, pointerId: 1 })
    fireEvent.pointerUp(track, { clientX: 110, pointerId: 1 })
    fireEvent.keyDown(window, { key: 's' })
    expect(await screen.findByRole('button', { name: /End skip \(from 0:11\)/ })).toBeTruthy()
    fireEvent.pointerDown(track, { button: 0, clientX: 150, pointerId: 1 })
    fireEvent.pointerUp(track, { clientX: 150, pointerId: 1 })
    fireEvent.keyDown(window, { key: 's' })
    expect(api.updateRecordingSkips).toHaveBeenLastCalledWith(node.id, [
      { clipId: 'a', startMs: 4_000, endMs: 6_000 },
      { clipId: 'b', startMs: 1_000, endMs: 5_000 },
    ])
  })

  it('retries a failed transcript and deletes a take after confirming', async () => {
    api.deleteRecordingClip.mockResolvedValue({ ...recording, clips: [recording.clips[0]!] })
    renderEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(api.retryRecordingTranscript).toHaveBeenCalledWith(node.id, 'b')
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Take 2 actions' }), { button: 0, ctrlKey: false })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete take' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Delete take 2?')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete take' }))
    expect(api.deleteRecordingClip).toHaveBeenCalledWith(node.id, 'b')
  })

  it('shows takes still being saved, and offers to retry one that failed', () => {
    act(() => useTakeUploads.setState({
      takes: [
        { key: 'k1', recordingId: node.id, audio: new Blob(), metadata: { durationMs: 1_000, levels: [] }, status: 'failed', error: 'Offline' },
        { key: 'k2', recordingId: node.id, audio: new Blob(), metadata: { durationMs: 1_000, levels: [] }, status: 'waiting', error: null },
        { key: 'k3', recordingId: 'another', audio: new Blob(), metadata: { durationMs: 1_000, levels: [] }, status: 'waiting', error: null },
      ],
    }))
    renderEditor()
    expect(screen.getByText('Take 3')).toBeTruthy()
    expect(screen.getByText('Offline')).toBeTruthy()
    expect(screen.getByText('Take 4')).toBeTruthy()
    expect(screen.getAllByText('Saving take…')).toHaveLength(1)
    expect(screen.queryByText('Take 5')).toBeNull()
    expect(screen.getByRole('button', { name: 'Record more' })).toBeTruthy()
  })

  it('only plays a recording in the trash', () => {
    renderEditor(false)
    expect(screen.queryByRole('button', { name: /Record/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mark skip' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Skip this part' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy()
  })

  it('starts empty with just the record button', () => {
    renderEditor(true, { node, clips: [] })
    expect(screen.getByRole('button', { name: 'Record' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull()
    expect(screen.getByText('Nothing recorded yet')).toBeTruthy()
  })
})
