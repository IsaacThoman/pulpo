import { GlassView } from 'expo-glass-effect'
import { useEffect, useState } from 'react'
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import Reanimated, { FadeInDown, FadeOutDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { liquidGlassAvailable } from '../../../platform/glass'
import { useAppTheme } from '../../../theme'
import { useFilesToasts } from '../toasts'

/** The floating confirmation (with Undo) for Files actions, above the screen's bottom edge. */
export function FilesToastHost({ bottomOffset = 0 }: { bottomOffset?: number }) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  const toast = useFilesToasts((state) => state.toast)
  const dismiss = useFilesToasts((state) => state.dismiss)
  const [undoing, setUndoing] = useState(false)
  useEffect(() => {
    if (toast) AccessibilityInfo.announceForAccessibility(toast.message)
  }, [toast])
  if (!toast) return null
  const content = (
    <View style={styles.row}>
      <Text numberOfLines={2} style={[styles.message, { color: toast.tone === 'error' ? theme.red : theme.text }]}>{toast.message}</Text>
      {toast.undo ? (
        <Pressable
          accessibilityRole="button"
          disabled={undoing}
          hitSlop={8}
          onPress={() => {
            setUndoing(true)
            void toast.undo!().finally(() => {
              setUndoing(false)
              dismiss(toast.id)
            })
          }}
          style={({ pressed }) => [styles.undo, pressed && { opacity: 0.6 }]}
        >
          <Text style={[styles.undoLabel, { color: theme.blue, opacity: undoing ? 0.5 : 1 }]}>Undo</Text>
        </Pressable>
      ) : null}
    </View>
  )
  return (
    <Reanimated.View
      key={toast.id}
      entering={FadeInDown.duration(180)}
      exiting={FadeOutDown.duration(150)}
      pointerEvents="box-none"
      style={[styles.host, { bottom: insets.bottom + 12 + bottomOffset }]}
    >
      {Platform.OS === 'ios' && liquidGlassAvailable
        ? <GlassView glassEffectStyle="regular" isInteractive style={styles.capsule}>{content}</GlassView>
        : <View style={[styles.capsule, { backgroundColor: theme.elevated, borderColor: theme.separator, borderWidth: StyleSheet.hairlineWidth }]}>{content}</View>}
    </Reanimated.View>
  )
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 16, right: 16, alignItems: 'center' },
  capsule: { maxWidth: 560, width: '100%', borderRadius: 26, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 13 },
  message: { flex: 1, fontSize: 15, lineHeight: 20 },
  undo: { paddingHorizontal: 4, paddingVertical: 2 },
  undoLabel: { fontSize: 16, fontWeight: '600' },
})
