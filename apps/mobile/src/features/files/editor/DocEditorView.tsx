import type { FormatCommand } from '@pulpo/client-core/doc-editor'
import * as Crypto from 'expo-crypto'
import { requireNativeViewManager } from 'expo-modules-core'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type Ref } from 'react'
import { Alert, Platform, type StyleProp, type ViewStyle } from 'react-native'
import { promptText } from '../../../platform/materialActions'
import PulpoDocEditor from '../../../../modules/pulpo-doc-editor'
import { useAppTheme } from '../../../theme'
import type { DocHandle } from '../doc/sessions'
import { EditorBridge, type EditorBridgeState } from './bridge'
import { EDITOR_BUNDLES, type MobileEditorFormat } from './bundles'
import { editorTheme, normalizeHref } from './presentation'
import { notebookToolbarState, NOTEBOOK_TOOLBAR } from './notebookToolbar'
import type { NotebookCommand, PresentationCommand, ReviewAction, TextCommand } from './protocol'
import { presentationToolbarState } from './presentationToolbar'
import { TEXT_TOOLBAR, textToolbarState, type NativeToolbarItem } from './textToolbar'

type NativeToolbar = { visible: boolean; active: string[]; disabled: string[]; tint: string; items: NativeToolbarItem[] }
type NativeProps = {
  ref?: Ref<NativeRef>
  style?: StyleProp<ViewStyle>
  instanceId: string
  html: string
  pageBackground: string
  toolbar: NativeToolbar
  onMessage: (event: { nativeEvent: { data: string } }) => void
  onTerminate: () => void
  onToolbarAction: (event: { nativeEvent: { command: string } }) => void
}
interface NativeRef {
  postMessage(message: string): Promise<void>
  showFind(): Promise<void>
  dismissKeyboard(): Promise<void>
}

const NativeDocEditor = PulpoDocEditor
  ? requireNativeViewManager<NativeProps>('PulpoDocEditor')
  : null

/** Whether this binary has the native editor host (older binaries and other platforms do not). */
export const docEditorAvailable = NativeDocEditor !== null

/** The native web view host itself, for pages that are not a document session (a deck's review diff). */
export { NativeDocEditor }
export type { NativeProps as NativeDocEditorProps, NativeRef as NativeDocEditorRef }

/**
 * Sessions whose editor is closing: the native host pulls the page's whole state one last time,
 * and the session is held until it is merged (or a short wait passes).
 */
const closing = new Map<string, { bridge: EditorBridge; handle: DocHandle; timer: ReturnType<typeof setTimeout> }>()
/** Editors on screen: the native host also sends their state when they leave the window (e.g. covered by another screen). */
const live = new Map<string, EditorBridge>()
const FINAL_STATE_WAIT_MS = 3_000

PulpoDocEditor?.addListener('onFinalState', ({ instanceId, state }) => {
  // Merging is idempotent, so a state sent while the editor is still mounted is merged too.
  const mounted = live.get(instanceId)
  if (mounted) mounted.mergeFinalState(state)
  const pending = closing.get(instanceId)
  if (!pending) return
  closing.delete(instanceId)
  clearTimeout(pending.timer)
  pending.bridge.mergeFinalState(state)
  pending.bridge.destroy()
  pending.handle.release()
})

const noSubscription = () => () => {}
const INITIAL: EditorBridgeState = { loaded: false, formatting: null, focused: false, suggestions: { count: 0, index: null, active: null }, text: null, notebook: null, presentation: null, incompatible: false }
const initialState = () => INITIAL

export interface DocEditorHandle {
  format(command: FormatCommand, href?: string): void
  /** A text or notebook editor's command. */
  command(command: TextCommand | NotebookCommand | PresentationCommand): void
  /** A formatting bar's command, asking for a link's address where needed. */
  toolbar(command: FormatCommand): void
  review(action: ReviewAction): void
  focus(at?: 'start' | 'end'): void
  exportMarkdown(): Promise<string>
  showFind(): void
  dismissKeyboard(): void
}

interface Props {
  /** The document's live format, which picks the editor page (Markdown unless given). */
  format?: MobileEditorFormat
  /** The file name, for editors that depend on it (a code file's language). */
  name?: string
  /** Fetches the document's assets for the page (a notebook's images). */
  fetchAsset?: (hash: string) => Promise<Uint8Array>
  /** The document's session; the editor takes its own hold on it while it closes. */
  acquire: () => DocHandle
  editable: boolean
  placeholder: string
  /** How other sessions label this one's caret, e.g. "Pulpo on iPhone". */
  sessionLabel: string
  sessionColor: string
  bottomPadding?: number
  style?: StyleProp<ViewStyle>
  onStateChange?: (state: EditorBridgeState) => void
  onLink?: (href: string) => void
  onResolved?: () => void
  /** Overrides the web view's background (black while a deck's slide show runs). */
  pageBackground?: string
}

export const DocEditorView = forwardRef<DocEditorHandle, Props>(function DocEditorView({
  format = 'markdown',
  name,
  acquire,
  editable,
  placeholder,
  sessionLabel,
  sessionColor,
  bottomPadding = 0,
  style,
  onStateChange,
  onLink,
  onResolved,
  fetchAsset,
  pageBackground,
}, ref) {
  const native = useRef<NativeRef>(null)
  const theme = useAppTheme()
  const bundle = EDITOR_BUNDLES[format]
  const latest = useRef({ acquire, editable, placeholder, sessionLabel, sessionColor, theme, bottomPadding, onLink, onResolved, bundle, name, fetchAsset })
  latest.current = { acquire, editable, placeholder, sessionLabel, sessionColor, theme, bottomPadding, onLink, onResolved, bundle, name, fetchAsset }
  const [instance, setInstance] = useState<{ id: string; bridge: EditorBridge; handle: DocHandle } | null>(null)

  // The session and page are made once per mounted editor, in an effect so that a discarded
  // render never takes a hold on the session.
  useEffect(() => {
    const props = latest.current
    const handle = props.acquire()
    const { controller } = handle
    const id = Crypto.randomUUID()
    const bridge = new EditorBridge({
      doc: controller.doc,
      awareness: controller.provider.awareness,
      send: (message) => { void native.current?.postMessage(message).catch(() => undefined) },
      editable: props.editable,
      placeholder: props.placeholder,
      user: { name: props.sessionLabel, color: props.sessionColor },
      theme: editorTheme(props.theme, props.bottomPadding),
      schemaVersion: props.bundle.schemaVersion,
      format: props.bundle.format,
      name: props.name,
      onLink: (href) => latest.current.onLink?.(href),
      fetchAsset: (hash) => latest.current.fetchAsset?.(hash) ?? Promise.reject(new Error('No assets here')),
      onResolved: () => latest.current.onResolved?.(),
    })
    // This session's caret is labeled for other devices viewing the document.
    controller.provider.awareness.setLocalStateField('user', { name: props.sessionLabel, color: props.sessionColor })
    setInstance({ id, bridge, handle })
    live.set(id, bridge)
    return () => {
      live.delete(id)
      // Keep the session until the page's final state is merged; see `closing`.
      const timer = setTimeout(() => {
        if (!closing.delete(id)) return
        bridge.destroy()
        handle.release()
      }, FINAL_STATE_WAIT_MS)
      closing.set(id, { bridge, handle, timer })
    }
  }, [])

  const bridge = instance?.bridge ?? null
  const state = useSyncExternalStore(bridge?.subscribe ?? noSubscription, bridge?.getState ?? initialState)

  useEffect(() => {
    onStateChange?.(state)
  }, [onStateChange, state])

  useEffect(() => {
    bridge?.setEditable(editable)
  }, [bridge, editable])

  useEffect(() => {
    bridge?.setTheme(editorTheme(theme, bottomPadding))
  }, [bridge, theme, bottomPadding])

  useEffect(() => {
    if (name) bridge?.setName(name)
  }, [bridge, name])

  const runToolbar = (command: string) => {
    if (!bridge) return
    if (format === 'text' || format === 'notebook' || format === 'presentation') {
      bridge.command(command as TextCommand | NotebookCommand | PresentationCommand)
      return
    }
    if (command !== 'link') {
      bridge.format(command as FormatCommand)
      return
    }
    const current = state.formatting?.linkHref ?? null
    const save = (value?: string) => { if (value?.trim()) bridge.format('link', normalizeHref(value)) }
    if (Platform.OS === 'ios') {
      Alert.prompt(
        current ? 'Edit link' : 'Add link',
        undefined,
        [
          { text: 'Cancel', style: 'cancel' },
          ...(current ? [{ text: 'Remove link', style: 'destructive' as const, onPress: () => bridge.format('link', '') }] : []),
          { text: 'Save', isPreferred: true, onPress: save },
        ],
        'plain-text',
        current ?? 'https://',
        'url',
      )
    } else {
      promptText({ title: current ? 'Edit link' : 'Add link', message: current ? 'Leave empty to remove the link.' : undefined, value: current ?? 'https://', confirmLabel: 'Save', onSubmit: (value) => value.trim() ? save(value) : current ? bridge.format('link', '') : undefined })
    }
  }
  const runToolbarRef = useRef(runToolbar)
  runToolbarRef.current = runToolbar

  useImperativeHandle(ref, () => ({
    format: (command, href) => bridge?.format(command, href),
    command: (command) => bridge?.command(command),
    toolbar: (command) => runToolbarRef.current(command),
    review: (action) => bridge?.review(action),
    focus: (at) => bridge?.focus(at),
    exportMarkdown: () => bridge ? bridge.exportMarkdown() : Promise.reject(new Error('The editor has not loaded')),
    showFind: () => { void native.current?.showFind() },
    dismissKeyboard: () => { void native.current?.dismissKeyboard() },
  }), [bridge])

  if (!NativeDocEditor || !instance || !bridge) return null
  const formatting = format === 'text' ? textToolbarState(state) : format === 'notebook' ? notebookToolbarState(state) : format === 'presentation' ? presentationToolbarState(state) : state.formatting
  return (
    <NativeDocEditor
      ref={native}
      style={style}
      instanceId={instance.id}
      html={bundle.html}
      pageBackground={pageBackground ?? editorTheme(theme).background}
      toolbar={{
        // Decks have an always-on bar of their own (PresentationBar), not a keyboard accessory.
        visible: editable && state.loaded && format !== 'presentation',
        active: formatting?.active ?? [],
        disabled: formatting?.disabled ?? [],
        tint: theme.blue,
        items: format === 'text' ? [...TEXT_TOOLBAR] : format === 'notebook' ? [...NOTEBOOK_TOOLBAR] : [],
      }}
      onMessage={({ nativeEvent }) => bridge.receive(nativeEvent.data)}
      onTerminate={() => bridge.reset()}
      onToolbarAction={({ nativeEvent }) => runToolbar(nativeEvent.command)}
    />
  )
})
