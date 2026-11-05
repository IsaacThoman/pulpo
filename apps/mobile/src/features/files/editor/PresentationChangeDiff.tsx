import * as Crypto from 'expo-crypto'
import { useCallback, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { apiUrl, nativeAuthorizationHeaders } from '../../../api/client'
import { useAppTheme } from '../../../theme'
import { bytesToBase64 } from './base64'
import { NativeDocEditor, type NativeDocEditorRef } from './DocEditorView'
import { PRESENTATION_EDITOR_BUNDLE } from './presentationEditorBundle.generated'
import { editorTheme } from './presentation'
import type { EditorMessage, HostMessage } from './protocol'

/** Larger proposals are reviewed as text: both versions travel to the page in one message. */
const MAX_DIFF_BYTES = 40 * 1024 * 1024
const SESSION = 1

async function fetchSide(changeId: string, side: 'before' | 'after'): Promise<Uint8Array> {
  const url = apiUrl(`/api/file-changes/${encodeURIComponent(changeId)}/content/${side}`)
  const response = await fetch(url, { headers: nativeAuthorizationHeaders(url) })
  if (!response.ok) throw new Error(`The ${side} version is unavailable`)
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * An agent's proposed deck against the current one, drawn by the presentation page in review
 * mode: changed slides with before and after thumbnails and their text changes. `onFailed` hands
 * back to the text diff when a version cannot be fetched or read.
 */
export function PresentationChangeDiff({ changeId, onFailed }: { changeId: string; onFailed: () => void }) {
  const theme = useAppTheme()
  const native = useRef<NativeDocEditorRef>(null)
  const [loaded, setLoaded] = useState(false)
  const instanceId = useMemo(() => Crypto.randomUUID(), [])

  const send = useCallback((message: HostMessage) => {
    void native.current?.postMessage(JSON.stringify(message)).catch(() => undefined)
  }, [])

  const start = useCallback(async () => {
    try {
      const [before, after] = await Promise.all([fetchSide(changeId, 'before'), fetchSide(changeId, 'after')])
      if (before.byteLength + after.byteLength > MAX_DIFF_BYTES) throw new Error('Too large to compare here')
      send({ type: 'presentationDiff', session: SESSION, before: bytesToBase64(before), after: bytesToBase64(after), theme: editorTheme(theme) })
    } catch {
      onFailed()
    }
  }, [changeId, onFailed, send, theme])

  const receive = useCallback((data: string) => {
    let message: EditorMessage
    try {
      message = JSON.parse(data) as EditorMessage
    } catch {
      return
    }
    if (message.type === 'ready') {
      // Also after the page reloads because its web content process ended: show the diff again.
      void start()
    } else if (message.type === 'loaded' && message.session === SESSION) setLoaded(true)
    else if (message.type === 'error' && (message.session === SESSION || message.session === null)) onFailed()
  }, [onFailed, start])

  if (!NativeDocEditor) return null
  return (
    <View style={styles.flex} testID="presentation-change-diff">
      <NativeDocEditor
        ref={native}
        style={styles.flex}
        instanceId={instanceId}
        html={PRESENTATION_EDITOR_BUNDLE.html}
        pageBackground={editorTheme(theme).background}
        toolbar={{ visible: false, active: [], disabled: [], tint: theme.blue, items: [] }}
        onMessage={({ nativeEvent }) => receive(nativeEvent.data)}
        onTerminate={() => setLoaded(false)}
        onToolbarAction={() => undefined}
      />
      {loaded ? null : <View style={styles.loading} pointerEvents="none"><ActivityIndicator color={theme.secondary} /></View>}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
})
