import type { ComponentProps, PropsWithChildren, ReactNode } from 'react'
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SymbolView } from 'expo-symbols'
import { useAppTheme } from '../../theme'

type SymbolName = ComponentProps<typeof SymbolView>['name']

export function AuthShell({ title, subtitle, children, footer }: PropsWithChildren<{ title: string; subtitle: string; footer?: ReactNode }>) {
  const insets = useSafeAreaInsets()
  const theme = useAppTheme()
  return <KeyboardAvoidingView style={[styles.root, { backgroundColor: theme.isDark ? '#101014' : '#FFFFFF' }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingTop: insets.top + 42, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.brand}>
        <Image source={require('../../../assets/pulpo-smiley.png')} style={styles.logo} />
        <Text style={[styles.brandName, { color: theme.text }]}>Pulpo</Text>
      </View>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: theme.secondary }]}>{subtitle}</Text>
      </View>
      <View style={styles.form}>{children}</View>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </ScrollView>
  </KeyboardAvoidingView>
}

export function AuthField({ icon, label, invalid = false, ...props }: ComponentProps<typeof TextInput> & { icon: SymbolName; label: string; invalid?: boolean }) {
  const theme = useAppTheme()
  return <View style={[styles.field, { backgroundColor: theme.isDark ? '#18181C' : '#F8F8FA', borderColor: invalid ? theme.red : theme.isDark ? '#303036' : '#E2E2E7' }]}>
    <SymbolView name={icon} tintColor={theme.tertiary} size={18} />
    <TextInput accessibilityLabel={label} placeholder={label} placeholderTextColor={theme.tertiary} autoCapitalize="none" style={[styles.input, { color: theme.text }]} {...props} />
  </View>
}

export function AuthButton({ label, loading = false, disabled = false, icon, onPress }: { label: string; loading?: boolean; disabled?: boolean; icon?: SymbolName; onPress: () => void }) {
  const theme = useAppTheme()
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled || loading} onPress={onPress} style={[styles.primaryButton, { backgroundColor: theme.accent, opacity: disabled || loading ? 0.45 : 1 }]}>
    {loading ? <ActivityIndicator color={theme.accentText} /> : <><Text style={[styles.primaryButtonText, { color: theme.accentText }]}>{label}</Text>{icon ? <SymbolView name={icon} tintColor={theme.accentText} size={16} weight="semibold" /> : null}</>}
  </Pressable>
}

export function AuthError({ children }: { children?: ReactNode }) {
  const theme = useAppTheme()
  return children ? <Text accessibilityRole="alert" style={[styles.error, { color: theme.red }]}>{children}</Text> : null
}

export function AuthLink({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useAppTheme()
  return <Pressable accessibilityRole="link" onPress={onPress} style={styles.linkTarget}><Text style={[styles.link, { color: theme.secondary }]}>{label}</Text></Pressable>
}

export const authStyles = StyleSheet.create({
  instanceButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12 },
  instanceText: { maxWidth: 210, fontSize: 12.5 },
  footerLinks: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  note: { fontSize: 12.5, lineHeight: 18, textAlign: 'center', paddingHorizontal: 10 },
})

const styles = StyleSheet.create({
  root: { flex: 1 }, content: { flexGrow: 1, paddingHorizontal: 22 }, brand: { flexDirection: 'row', alignItems: 'center', gap: 10 }, logo: { width: 42, height: 42, borderRadius: 13 }, brandName: { fontSize: 24, fontWeight: '700', letterSpacing: -0.7 },
  heading: { marginTop: 72 }, title: { fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: -1.1 }, subtitle: { marginTop: 9, fontSize: 17, lineHeight: 24 }, form: { marginTop: 32, gap: 14 }, footer: { marginTop: 'auto', paddingTop: 32 },
  field: { minHeight: 56, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, input: { flex: 1, fontSize: 17, paddingVertical: 14 },
  primaryButton: { minHeight: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, primaryButtonText: { fontSize: 16, fontWeight: '600' }, error: { fontSize: 13.5, lineHeight: 19 }, linkTarget: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 }, link: { fontSize: 13.5, fontWeight: '600' },
})
