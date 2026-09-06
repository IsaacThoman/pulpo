import { MaterialIconButton } from '../platform/MaterialUI'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import { SymbolView } from '../platform/SymbolView'
import {
  Button as SwiftUIButton,
  Host as SwiftUIHost,
  Image as SwiftUIImage,
} from '@expo/ui/swift-ui'
import {
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  frame,
} from '@expo/ui/swift-ui/modifiers'
import { useAppTheme } from '../theme'

/** The only Router UI primitive still needed by the public-share route. */
export function GlassIconButton({ colorScheme, icon, label, onPress }: {
  colorScheme?: 'light' | 'dark'
  icon: string
  label: string
  onPress: () => void
}) {
  const theme = useAppTheme()
  const foreground = colorScheme === 'dark' ? '#ffffff' : theme.text
  if (Platform.OS === 'ios') {
    return <SwiftUIHost colorScheme={colorScheme} matchContents style={styles.iconButton}>
      <SwiftUIButton
        onPress={onPress}
        modifiers={[
          buttonStyle('glass'),
          buttonBorderShape('circle'),
          controlSize('regular'),
          accessibilityLabel(label),
        ]}
      >
        <SwiftUIImage systemName={icon as never} size={18} modifiers={[frame({ width: 28, height: 28 })]} />
      </SwiftUIButton>
    </SwiftUIHost>
  }
  if (Platform.OS === 'android') return <MaterialIconButton icon={icon} label={label} onPress={onPress} color={foreground} />
  return <Pressable
    accessibilityLabel={label}
    accessibilityRole="button"
    onPress={onPress}
    style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
  >
    <View style={[styles.glassFill, { backgroundColor: theme.fillStrong }]}>
      <SymbolView name={icon as never} size={18} tintColor={foreground} weight="semibold" />
    </View>
  </Pressable>
}

const styles = StyleSheet.create({
  iconButton: { width: 44, height: 44 },
  glassFill: { flex: 1, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.65, transform: [{ scale: 0.96 }] },
})
