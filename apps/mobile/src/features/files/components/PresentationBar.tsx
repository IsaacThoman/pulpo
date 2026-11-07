import * as Haptics from 'expo-haptics'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { KeyboardStickyView } from 'react-native-keyboard-controller'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SymbolView } from '../../../platform/SymbolView'
import { useAppTheme } from '../../../theme'
import type { FormattingBarItem } from './FormattingBar'

/** Height of the bar, without the safe area under it. */
export const PRESENTATION_BAR_HEIGHT = 52

/**
 * The presentation editor's bar, always shown while editing (unlike text formatting, most deck
 * work happens without the keyboard), and lifted above the keyboard while typing in a shape.
 * The same on iOS and Android.
 */
export function PresentationBar({ items, state, visible, onCommand }: {
  items: readonly FormattingBarItem[]
  state: { active: readonly string[]; disabled: readonly string[] }
  visible: boolean
  onCommand: (command: string) => void
}) {
  const theme = useAppTheme()
  const insets = useSafeAreaInsets()
  if (!visible) return null
  const active = new Set(state.active)
  const disabled = new Set(state.disabled)
  return (
    <KeyboardStickyView style={styles.sticky} offset={{ opened: insets.bottom }}>
      <View style={[styles.bar, { backgroundColor: theme.elevated, borderTopColor: theme.separator, paddingBottom: insets.bottom }]} testID="presentation-bar">
        <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.items}>
          {items.map((item) => {
            const on = active.has(item.command)
            const off = disabled.has(item.command)
            return (
              <Pressable
                key={item.command}
                accessibilityLabel={item.label}
                accessibilityRole="button"
                accessibilityState={{ disabled: off, selected: on }}
                disabled={off}
                onPress={() => {
                  Haptics.selectionAsync()
                  onCommand(item.command)
                }}
                style={[styles.button, on && { backgroundColor: theme.fillStrong }, off && { opacity: 0.35 }]}
                testID={`presentation-${item.command}`}
              >
                <SymbolView name={item.systemImage as never} size={22} tintColor={on ? theme.blue : theme.text} />
              </Pressable>
            )
          })}
        </ScrollView>
      </View>
    </KeyboardStickyView>
  )
}

const styles = StyleSheet.create({
  sticky: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bar: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 4 },
  items: { height: PRESENTATION_BAR_HEIGHT, alignItems: 'center', paddingHorizontal: 4, gap: 2 },
  button: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
})
