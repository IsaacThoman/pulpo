import type { FormatCommand, FormattingState } from '@pulpo/client-core/doc-editor'
import * as Haptics from 'expo-haptics'
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { KeyboardStickyView } from 'react-native-keyboard-controller'
import { showActions } from '../../../platform/materialActions'
import { SymbolView } from '../../../platform/SymbolView'
import { useAppTheme } from '../../../theme'

/** Height of the bar, which the editor keeps clear below the caret. */
export const FORMATTING_BAR_HEIGHT = 52

type Item =
  | { command: FormatCommand; label: string; symbol: string }
  | { menu: string; label: string; symbol: string; options: Array<{ command: FormatCommand; label: string }> }
  | { separator: true }

const ITEMS: Item[] = [
  { command: 'undo', label: 'Undo', symbol: 'arrow.uturn.backward' },
  { command: 'redo', label: 'Redo', symbol: 'arrow.uturn.forward' },
  { separator: true },
  { menu: 'text', label: 'Text style', symbol: 'textformat.size', options: [
    { command: 'paragraph', label: 'Body' },
    { command: 'heading1', label: 'Heading 1' },
    { command: 'heading2', label: 'Heading 2' },
    { command: 'heading3', label: 'Heading 3' },
  ] },
  { command: 'bold', label: 'Bold', symbol: 'bold' },
  { command: 'italic', label: 'Italic', symbol: 'italic' },
  { command: 'strike', label: 'Strikethrough', symbol: 'strikethrough' },
  { command: 'code', label: 'Inline code', symbol: 'chevron.left.forwardslash.chevron.right' },
  { command: 'link', label: 'Link', symbol: 'link' },
  { separator: true },
  { menu: 'lists', label: 'Lists', symbol: 'list.bullet', options: [
    { command: 'bulletList', label: 'Bulleted list' },
    { command: 'orderedList', label: 'Numbered list' },
    { command: 'taskList', label: 'Checklist' },
  ] },
  { command: 'outdent', label: 'Outdent', symbol: 'decrease.indent' },
  { command: 'indent', label: 'Indent', symbol: 'increase.indent' },
  { separator: true },
  { command: 'blockquote', label: 'Quote', symbol: 'text.quote' },
  { command: 'codeBlock', label: 'Code block', symbol: 'curlybraces.square' },
  { command: 'table', label: 'Table', symbol: 'tablecells' },
  { command: 'divider', label: 'Divider', symbol: 'minus' },
]

/**
 * The formatting bar above the keyboard where the platform has no keyboard accessory for web
 * content (Android). iOS shows the native SwiftUI bar inside the editor host instead.
 */
export function FormattingBar({ formatting, visible, onCommand, onDismissKeyboard }: {
  formatting: FormattingState | null
  visible: boolean
  onCommand: (command: FormatCommand) => void
  onDismissKeyboard: () => void
}) {
  const theme = useAppTheme()
  if (Platform.OS !== 'android' || !visible || !formatting) return null
  const active = new Set(formatting.active)
  const disabled = new Set(formatting.disabled)
  const run = (command: FormatCommand) => {
    Haptics.selectionAsync()
    onCommand(command)
  }
  return (
    <KeyboardStickyView style={styles.sticky}>
      <View style={[styles.bar, { backgroundColor: theme.elevated, borderTopColor: theme.separator }]} testID="formatting-bar">
        <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.items}>
          {ITEMS.map((item, index) => {
            if ('separator' in item) return <View key={`separator-${index}`} style={[styles.separator, { backgroundColor: theme.separator }]} />
            if ('menu' in item) {
              const on = item.options.some((option) => option.command !== 'paragraph' && active.has(option.command))
              return (
                <Pressable
                  key={item.menu}
                  accessibilityLabel={item.label}
                  accessibilityRole="button"
                  onPress={() => showActions(item.label, item.options.map((option) => ({
                    label: option.label,
                    selected: active.has(option.command),
                    onPress: () => run(option.command),
                  })))}
                  style={[styles.button, on && { backgroundColor: theme.fillStrong }]}
                >
                  <SymbolView name={item.symbol as never} size={22} tintColor={on ? theme.blue : theme.text} />
                </Pressable>
              )
            }
            const on = active.has(item.command)
            const off = disabled.has(item.command)
            return (
              <Pressable
                key={item.command}
                accessibilityLabel={item.label}
                accessibilityRole="button"
                accessibilityState={{ disabled: off, selected: on }}
                disabled={off}
                onPress={() => run(item.command)}
                style={[styles.button, on && { backgroundColor: theme.fillStrong }, off && { opacity: 0.35 }]}
                testID={`formatting-${item.command}`}
              >
                <SymbolView name={item.symbol as never} size={22} tintColor={on ? theme.blue : theme.text} />
              </Pressable>
            )
          })}
        </ScrollView>
        <Pressable accessibilityLabel="Hide keyboard" accessibilityRole="button" onPress={onDismissKeyboard} style={styles.button}>
          <SymbolView name="keyboard.chevron.compact.down" size={22} tintColor={theme.text} />
        </Pressable>
      </View>
    </KeyboardStickyView>
  )
}

const styles = StyleSheet.create({
  sticky: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bar: { height: FORMATTING_BAR_HEIGHT, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 4 },
  items: { alignItems: 'center', paddingHorizontal: 4, gap: 2 },
  button: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  separator: { width: 1, height: 22, marginHorizontal: 4 },
})
