// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DictationController } from './dictation'
import { setComposerSelection } from './composerSelection'

const appState = vi.hoisted(() => ({ change: (_state: string) => {} }))
vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, AppState: {
  addEventListener: (_event: string, change: (state: string) => void) => { appState.change = change; return { remove: vi.fn() } },
} }))
vi.mock('expo-audio', () => ({}))
vi.mock('expo-file-system', () => ({}))
import { useDictation } from './useDictation'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root | undefined
let host: HTMLDivElement | undefined
afterEach(async () => { await act(async () => root?.unmount()); host?.remove() })

async function fixture() {
  const recorder = { prepare: vi.fn(async () => {}), record: vi.fn(), stop: vi.fn(async () => {}), release: vi.fn(), uri: 'file:///audio.m4a', isRecording: true }
  let respond!: (value: string) => void
  const deps = {
    permission: vi.fn(async () => true), audioMode: vi.fn(async () => {}), recorder: () => recorder,
    size: () => 123, remove: vi.fn(), transcribe: vi.fn(() => new Promise<string>((resolve) => { respond = resolve })),
  }
  const controller = new DictationController(deps)
  let view!: ReturnType<typeof useDictation>
  let text = 'replace this please'
  const selectionRef = { current: { start: 8, end: 12 } }
  const apply = vi.fn((value: string) => { text = value })
  const input = { identity: 'account/chat', enabled: true, canStart: true, read: () => ({ text, selection: selectionRef.current }), apply }
  function Component() { view = useDictation(input, () => controller); return null }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  const render = () => act(async () => { root!.render(createElement(Component)) })
  await render()
  return {
    deps, input, apply, render, get view() { return view },
    setText: (value: string) => { text = value; selectionRef.current = { start: value.length, end: value.length } },
    restoreDraft: (value: string) => {
      text = value
      // iOS can move the visible caret without emitting a selection event.
      setComposerSelection(vi.fn(), selectionRef, { start: value.length, end: value.length })
    },
    respond: (value: string) => act(async () => { respond(value) }),
    start: () => act(async () => { view.start() }),
    stop: () => act(async () => { view.stop() }),
  }
}

describe('dictation composer ownership', () => {
  it('replaces selected text and restores the cursor through the normal composer callback', async () => {
    const f = await fixture(); await f.start(); await f.stop(); await f.respond('that')
    expect(f.apply).toHaveBeenCalledWith('replace that please', 12)
  })
  it('inserts at the restored native caret without relying on a selection event', async () => {
    const f = await fixture(); f.restoreDraft('Restored draft'); await f.render()
    await f.start(); await f.stop(); await f.respond('spoken words')
    expect(f.apply).toHaveBeenCalledWith('Restored draft spoken words', 27)
  })
  it('preserves local edits or synchronized text received during transcription', async () => {
    const f = await fixture(); await f.start(); await f.stop()
    f.setText('Updated from another client'); await f.render(); await f.respond('dictated')
    expect(f.apply).toHaveBeenCalledWith('Updated from another client dictated', 36)
  })
  it.each(['chat', 'account', 'instance', 'edit'])('ignores a late transcript after %s ownership changes', async (identity) => {
    const f = await fixture(); await f.start(); await f.stop()
    f.input.identity = identity; await f.render(); await f.respond('late')
    expect(f.apply).not.toHaveBeenCalled()
    expect(f.deps.remove).toHaveBeenCalledOnce()
  })
  it.each([true, false])('handles Android permission activity backgrounding (granted=%s)', async (granted) => {
    const f = await fixture()
    let resolve!: (value: boolean) => void
    f.deps.permission.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    await f.start()
    await act(async () => appState.change('background'))
    expect(f.view.phase).toBe('preparing')
    await act(async () => { appState.change('active'); resolve(granted) })
    expect(f.view.phase).toBe(granted ? 'recording' : 'idle')
    if (!granted) expect(f.view.error).toContain('Settings')
  })
  it('does not start in unavailable or busy contexts', async () => {
    const f = await fixture(); f.input.canStart = false; await f.render(); await f.start()
    expect(f.deps.permission).not.toHaveBeenCalled()
    f.input.canStart = true; f.input.enabled = false; await f.render(); await f.start()
    expect(f.deps.permission).not.toHaveBeenCalled()
  })
  it('cancels when the composer loses availability or navigation focus', async () => {
    const f = await fixture(); await f.start()
    f.input.enabled = false; await f.render()
    expect(f.view.phase).toBe('idle')
    expect(f.deps.remove).toHaveBeenCalledOnce()
    expect(f.deps.transcribe).not.toHaveBeenCalled()
  })
  it('cancels when backgrounded and allows another recording after returning', async () => {
    const f = await fixture(); await f.start()
    await act(async () => appState.change('background'))
    expect(f.view.phase).toBe('idle')
    expect(f.deps.transcribe).not.toHaveBeenCalled()
    await act(async () => appState.change('active'))
    await f.start(); expect(f.view.phase).toBe('recording')
  })
  it('cleans up on unmount without applying a transcript', async () => {
    const f = await fixture(); await f.start(); await f.stop()
    await act(async () => { root!.unmount() }); root = undefined
    await f.respond('late')
    expect(f.apply).not.toHaveBeenCalled()
    expect(f.deps.remove).toHaveBeenCalledOnce()
  })
})
