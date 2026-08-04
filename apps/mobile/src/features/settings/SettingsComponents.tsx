import type { ReactNode } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import {
  Button,
  HStack,
  Host,
  Image,
  Spacer,
  Text as SwiftText,
  VStack,
} from '@expo/ui/swift-ui'
import { buttonStyle, font, foregroundStyle, frame } from '@expo/ui/swift-ui/modifiers'
import { GlassIconButton } from '../../components/PrototypeUI'
import { useAppTheme } from '../../theme'

export function SettingsHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const theme = useAppTheme()
  return <View style={styles.header}><GlassIconButton icon="chevron.left" label="Back" onPress={() => router.back()} /><View style={styles.center}><Text style={[styles.title, { color: theme.text }]}>{title}</Text>{subtitle ? <Text style={[styles.subtitle, { color: theme.secondary }]}>{subtitle}</Text> : null}</View><View style={styles.right}>{right}</View></View>
}

export function NativeDestinationRow({ icon, title, detail, onPress, destructive = false }: { icon: string; title: string; detail?: string; onPress: () => void; destructive?: boolean }) {
  return <Button onPress={onPress} role={destructive ? 'destructive' : 'default'} modifiers={[buttonStyle('plain'), foregroundStyle(destructive ? 'red' : 'primary')]}>
    <HStack spacing={12} modifiers={[frame({ maxWidth: Infinity, minHeight: detail ? 48 : 42 })]}>
      <Image systemName={icon as never} size={17} modifiers={[frame({ width: 22, height: 22 })]} />
      <VStack alignment="leading" spacing={2}><SwiftText>{title}</SwiftText>{detail ? <SwiftText modifiers={[foregroundStyle('secondary'), font({ textStyle: 'footnote' })]}>{detail}</SwiftText> : null}</VStack>
      <Spacer />{!destructive ? <Image systemName="chevron.right" size={11} modifiers={[foregroundStyle('secondary')]} /> : null}
    </HStack>
  </Button>
}

export function SettingsNativeHost({ children }: { children: ReactNode }) {
  return <Host style={styles.host}>{children}</Host>
}

export const settingsStyles = StyleSheet.create({ root: { flex: 1 }, content: { flex: 1, paddingHorizontal: 18 } })

const styles = StyleSheet.create({
  header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18 }, center: { flex: 1, alignItems: 'center' }, title: { fontSize: 18, fontWeight: '700', letterSpacing: -0.35 }, subtitle: { fontSize: 11, marginTop: 1 }, right: { width: 44, alignItems: 'flex-end' }, host: { flex: 1 },
})
