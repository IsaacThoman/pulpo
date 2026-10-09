import { useRef } from 'react'
import { Text, TextInput, View, type TextInputProps } from 'react-native'
import type { SFSymbol } from 'expo-symbols'
import { useTVTheme, type } from '../theme'
import { Focusable } from './Focusable'
import { Icon } from './Icon'

type FieldProps = Omit<TextInputProps, 'style'> & {
  icon?: SFSymbol
  height?: number
  fontSize?: number
  /** Remote focus on the field itself, not the keyboard. */
  onFocusChange?: (focused: boolean) => void
}

/**
 * A text field sized for the remote. tvOS edits text in a full-screen keyboard
 * (with dictation and typing from a nearby iPhone), so the field itself is a
 * focusable surface that shows the value and opens the keyboard when selected.
 */
export function Field({ icon, height = 96, fontSize = type.body, onFocusChange, hasTVPreferredFocus, testID, value, placeholder, secureTextEntry, ...props }: FieldProps) {
  const theme = useTVTheme()
  const input = useRef<TextInput>(null)
  const shown = value ? (secureTextEntry ? '•'.repeat(value.length) : value) : placeholder
  return <View>
    <Focusable testID={testID} accessibilityRole="search" accessibilityLabel={placeholder} accessibilityValue={value && !secureTextEntry ? { text: value } : undefined}
      hasTVPreferredFocus={hasTVPreferredFocus} lift={1.03} onPress={() => input.current?.focus()}
      onFocus={() => onFocusChange?.(true)} onBlur={() => onFocusChange?.(false)}
      style={{ height, borderRadius: height / 2, paddingHorizontal: 36, justifyContent: 'center' }}>
      {(focused) => <View style={{ flexDirection: 'row', alignItems: 'center', gap: 22 }}>
        {icon ? <Icon name={icon} size={34} color={focused ? theme.focusText : theme.secondary} /> : null}
        <Text numberOfLines={1} style={{
          flex: 1, fontSize,
          color: value ? (focused ? theme.focusText : theme.text) : (focused ? theme.tertiary : theme.secondary),
        }}>{shown}</Text>
      </View>}
    </Focusable>
    <TextInput ref={input} {...props} value={value} placeholder={placeholder} secureTextEntry={secureTextEntry}
      focusable={false} accessible={false} style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} />
  </View>
}
