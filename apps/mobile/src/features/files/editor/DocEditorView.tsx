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
import { EDITOR_BUNDLE } from './editorBundle.generated'
import { editorTheme, normalizeHref } from './presentation'
import type { ReviewAction } from './protocol'

type NativeToolbar = { visible: boolean; active: string[]; disabled: string[]; tint: string }
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
const INITIAL: EditorBridgeState = { loaded: false, formatting: null, focused: false, suggestions: { count: 0, index: null, active: null }, incompatible: false }
const initialState = () => INITIAL

export interface DocEditorHandle {
  format(command: FormatCommand, href?: string): void
  /** A formatting bar's command, asking for a link's address where needed. */
  toolbar(command: FormatCommand): void
  review(action: ReviewAction): void
  focus(at?: 'start' | 'end'): void
  exportMarkdown(): Promise<string>
  showFind(): void
  dismissKeyboard(): void
}

interface Props {
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
}

export const DocEditorView = forwardRef<DocEditorHandle, Props>(function DocEditorView({
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
}, ref) {
  const native = useRef<NativeRef>(null)
  const theme = useAppTheme()
  const latest = useRef({ acquire, editable, placeholder, sessionLabel, sessionColor, theme, bottomPadding, onLink, onResolved })
  latest.current = { acquire, editable, placeholder, sessionLabel, sessionColor, theme, bottomPadding, onLink, onResolved }
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
      schemaVersion: EDITOR_BUNDLE.schemaVersion,
      onLink: (href) => latest.current.onLink?.(href),
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

  const runToolbar = (command: string) => {
    if (!bridge) return
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
    toolbar: (command) => runToolbarRef.current(command),
    review: (action) => bridge?.review(action),
    focus: (at) => bridge?.focus(at),
    exportMarkdown: () => bridge ? bridge.exportMarkdown() : Promise.reject(new Error('The editor has not loaded')),
    showFind: () => { void native.current?.showFind() },
    dismissKeyboard: () => { void native.current?.dismissKeyboard() },
  }), [bridge])

  if (!NativeDocEditor || !instance || !bridge) return null
  const formatting = state.formatting
  return (
    <NativeDocEditor
      ref={native}
      style={style}
      instanceId={instance.id}
      html={EDITOR_BUNDLE.html}
      pageBackground={editorTheme(theme).background}
      toolbar={{
        visible: editable && state.loaded,
        active: formatting?.active ?? [],
        disabled: formatting?.disabled ?? [],
        tint: theme.blue,
      }}
      onMessage={({ nativeEvent }) => bridge.receive(nativeEvent.data)}
      onTerminate={() => bridge.reset()}
      onToolbarAction={({ nativeEvent }) => runToolbar(nativeEvent.command)}
    />
  )
})
