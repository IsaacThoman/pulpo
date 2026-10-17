import type { FormatCommand } from '@pulpo/client-core/doc-editor'
import * as Crypto from 'expo-crypto'
import { requireNativeViewManager } from 'expo-modules-core'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore, type Ref } from 'react'
import { Alert, type StyleProp, type ViewStyle } from 'react-native'
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
const FINAL_STATE_WAIT_MS = 3_000

PulpoDocEditor?.addListener('onFinalState', ({ instanceId, state }) => {
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
    return () => {
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

  useImperativeHandle(ref, () => ({
    format: (command, href) => bridge?.format(command, href),
    review: (action) => bridge?.review(action),
    focus: (at) => bridge?.focus(at),
    exportMarkdown: () => bridge ? bridge.exportMarkdown() : Promise.reject(new Error('The editor has not loaded')),
    showFind: () => { void native.current?.showFind() },
    dismissKeyboard: () => { void native.current?.dismissKeyboard() },
  }), [bridge])

  if (!NativeDocEditor || !instance || !bridge) return null
  const formatting = state.formatting
  const runToolbar = (command: string) => {
    if (command === 'link') {
      const current = formatting?.linkHref ?? null
      Alert.prompt(
        current ? 'Edit link' : 'Add link',
        undefined,
        [
          { text: 'Cancel', style: 'cancel' },
          ...(current ? [{ text: 'Remove link', style: 'destructive' as const, onPress: () => bridge.format('link', '') }] : []),
          { text: 'Save', isPreferred: true, onPress: (value?: string) => { if (value?.trim()) bridge.format('link', normalizeHref(value)) } },
        ],
        'plain-text',
        current ?? 'https://',
        'url',
      )
      return
    }
    bridge.format(command as FormatCommand)
  }
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
