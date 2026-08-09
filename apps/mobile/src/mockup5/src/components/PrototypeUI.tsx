import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import {
  Button as SwiftUIButton,
  ColorPicker as SwiftUIColorPicker,
  HStack as SwiftUIHStack,
  Host as SwiftUIHost,
  Image as SwiftUIImage,
  Picker as SwiftUIPicker,
  SecureField as SwiftUISecureField,
  Spacer as SwiftUISpacer,
  Text as SwiftUIText,
  TextField as SwiftUITextField,
  Toggle as SwiftUIToggle,
  VStack as SwiftUIVStack,
  useNativeState,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel as swiftUIAccessibilityLabel,
  autocorrectionDisabled,
  buttonBorderShape,
  buttonStyle,
  controlSize,
  disabled as swiftUIDisabled,
  foregroundStyle,
  font,
  frame,
  keyboardType,
  labelStyle,
  labelsHidden,
  lineLimit,
  padding,
  pickerStyle,
  tag,
  textFieldStyle,
  textInputAutocapitalization,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { useAppTheme } from '../theme';
import { SETTINGS_CONTENT_MAX } from '../../../responsive';

export function Screen({ children, scroll = true, style }: { children: ReactNode; scroll?: boolean; style?: ViewStyle }) {
  const theme = useAppTheme();
  const content = scroll ? <ScrollView contentContainerStyle={[styles.screenContent, style]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{children}</ScrollView> : <View style={[styles.screenContent, styles.flex, style]}>{children}</View>;
  return <SafeAreaView edges={['top', 'bottom']} style={[styles.flex, { backgroundColor: theme.background }]}>{content}</SafeAreaView>;
}

export function PageHeader({ title, subtitle, onBack, right }: { title: string; subtitle?: string; onBack?: () => void; right?: ReactNode }) {
  const theme = useAppTheme();
  return <View style={styles.header}>
    {onBack ? <GlassIconButton icon="chevron.left" label="Back" onPress={onBack} /> : <View style={styles.iconButtonPlaceholder} />}
    <View style={styles.headerCenter}><Text style={[styles.headerTitle, { color: theme.text }]}>{title}</Text>{subtitle ? <Text numberOfLines={1} style={[styles.headerSubtitle, { color: theme.secondary }]}>{subtitle}</Text> : null}</View>
    <View style={styles.headerRight}>{right}</View>
  </View>;
}

export function GlassIconButton({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const theme = useAppTheme();
  if (Platform.OS === 'ios') return <SwiftUIHost matchContents style={styles.iconButton}><SwiftUIButton onPress={onPress} modifiers={[buttonStyle('glass'), buttonBorderShape('circle'), controlSize('regular'), swiftUIAccessibilityLabel(label)]}><SwiftUIImage systemName={icon as never} size={18} modifiers={[frame({ width: 28, height: 28 })]} /></SwiftUIButton></SwiftUIHost>;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}><View style={[styles.glassFill, { backgroundColor: theme.fillStrong }]}><SymbolView name={icon as never} size={18} tintColor={theme.text} weight="semibold" /></View></Pressable>;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const theme = useAppTheme();
  return <View style={[styles.card, { backgroundColor: theme.glass, borderColor: theme.separator, shadowColor: theme.shadow }, style]}>{children}</View>;
}

export function SectionTitle({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  const theme = useAppTheme();
  return <View style={styles.sectionTitleRow}><Text style={[styles.sectionTitle, { color: theme.secondary }]}>{children}</Text>{trailing}</View>;
}

export function ListRow({ icon, iconColor, leading, title, detail, value, onPress, destructive = false, last = false, children }: {
  icon?: string; iconColor?: string; leading?: ReactNode; title: string; detail?: string; value?: string; onPress?: () => void; destructive?: boolean; last?: boolean; children?: ReactNode;
}) {
  const theme = useAppTheme();
  if (Platform.OS === 'ios' && onPress && !leading && !children) {
    const rowHeight = detail ? 66 : 54;
    return <View style={!last ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.separator } : undefined}><SwiftUIHost style={{ height: rowHeight }}><SwiftUIButton onPress={onPress} role={destructive ? 'destructive' : 'default'} modifiers={[buttonStyle('plain'), foregroundStyle(destructive ? theme.red : 'primary')]}><SwiftUIHStack modifiers={[frame({ maxWidth: Infinity, minHeight: rowHeight }), padding({ horizontal: 14 })]} spacing={12}>{icon ? <SwiftUIImage systemName={icon as never} size={17} color={iconColor ?? (destructive ? theme.red : theme.secondary)} modifiers={[frame({ width: 22, height: 22 })]} /> : null}<SwiftUIVStack alignment="leading" spacing={3}><SwiftUIText modifiers={[font({ textStyle: 'subheadline', weight: 'medium' }), lineLimit(1)]}>{title}</SwiftUIText>{detail ? <SwiftUIText modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary'), lineLimit(1)]}>{detail}</SwiftUIText> : null}</SwiftUIVStack><SwiftUISpacer />{value ? <SwiftUIText modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary'), lineLimit(1)]}>{value}</SwiftUIText> : null}<SwiftUIImage systemName="chevron.right" size={11} color={theme.tertiary} /></SwiftUIHStack></SwiftUIButton></SwiftUIHost></View>;
  }
  const body = <>
    {icon ? <View style={[styles.rowIcon, { backgroundColor: `${iconColor ?? theme.secondary}20` }]}><SymbolView name={icon as never} size={17} tintColor={iconColor ?? theme.secondary} /></View> : null}
    {leading}
    <View style={styles.rowText}><Text style={[styles.rowTitle, { color: destructive ? theme.red : theme.text }]}>{title}</Text>{detail ? <Text style={[styles.rowDetail, { color: theme.secondary }]}>{detail}</Text> : null}</View>
    {value ? <Text style={[styles.rowValue, { color: theme.secondary }]}>{value}</Text> : null}
    {children}
    {onPress ? <SymbolView name="chevron.right" size={13} tintColor={theme.tertiary} weight="semibold" /> : null}
  </>;
  const baseStyle = [styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.separator }];
  if (!onPress) return <View style={baseStyle}>{body}</View>;
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [baseStyle, pressed && { backgroundColor: theme.fill }]}>{body}</Pressable>;
}

export function Field({ label, error, ...props }: TextInputProps & { label?: string; error?: string }) {
  const theme = useAppTheme();
  return <View style={styles.fieldWrap}>{label ? <Text style={[styles.fieldLabel, { color: theme.secondary }]}>{label}</Text> : null}{Platform.OS === 'ios' ? <NativeField {...props} /> : <TextInput placeholderTextColor={theme.secondary} {...props} style={[styles.field, { color: theme.text, backgroundColor: theme.elevated, borderColor: error ? theme.red : theme.separator }, props.style]} />}{error ? <Text style={[styles.fieldError, { color: theme.red }]}>{error}</Text> : null}</View>;
}

export function PasswordField({ label, value, onChangeText, placeholder, revealed, onToggleVisibility }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  revealed: boolean;
  onToggleVisibility: () => void;
}) {
  const theme = useAppTheme();
  const nativeText = useNativeState(value);
  useEffect(() => { if (nativeText.get() !== value) nativeText.set(value); }, [nativeText, value]);
  if (Platform.OS === 'ios') return <View style={styles.fieldWrap}>
    <Text style={[styles.fieldLabel, { color: theme.secondary }]}>{label}</Text>
    <SwiftUIHost style={styles.nativePasswordField}>
      <SwiftUIHStack spacing={8}>
        {revealed
          ? <SwiftUITextField text={nativeText} placeholder={placeholder} onTextChange={onChangeText} modifiers={[textFieldStyle('roundedBorder'), controlSize('large'), frame({ maxWidth: Infinity, minHeight: 50 })]} />
          : <SwiftUISecureField text={nativeText} placeholder={placeholder} onTextChange={onChangeText} modifiers={[textFieldStyle('roundedBorder'), controlSize('large'), frame({ maxWidth: Infinity, minHeight: 50 })]} />}
        <SwiftUIButton
          label={revealed ? 'Hide password' : 'Show password'}
          systemImage={revealed ? 'eye.slash' : 'eye'}
          onPress={onToggleVisibility}
          modifiers={[buttonStyle('plain'), labelStyle('iconOnly'), frame({ width: 44, height: 44 }), swiftUIAccessibilityLabel(revealed ? 'Hide password' : 'Show password')]}
        />
      </SwiftUIHStack>
    </SwiftUIHost>
  </View>;
  return <View style={styles.fieldWrap}>
    <Text style={[styles.fieldLabel, { color: theme.secondary }]}>{label}</Text>
    <View><TextInput secureTextEntry={!revealed} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={theme.secondary} style={[styles.field, { color: theme.text, backgroundColor: theme.elevated, borderColor: theme.separator, paddingRight: 54 }]} /><Pressable accessibilityRole="button" accessibilityLabel={revealed ? 'Hide password' : 'Show password'} onPress={onToggleVisibility} style={styles.passwordEye}><SymbolView name={revealed ? 'eye.slash' : 'eye'} size={17} tintColor={theme.secondary} /></Pressable></View>
  </View>;
}

function NativeField(props: TextInputProps) {
  const nativeText = useNativeState(String(props.value ?? ''));
  useEffect(() => { if (nativeText.get() !== String(props.value ?? '')) nativeText.set(String(props.value ?? '')); }, [nativeText, props.value]);
  const fieldHeight = props.multiline ? 130 : 50;
  const modifiers = [
    textFieldStyle('roundedBorder'), frame({ maxWidth: Infinity, minHeight: fieldHeight }), controlSize('large'),
    ...(props.keyboardType ? [keyboardType(props.keyboardType as never)] : []),
    ...(props.autoCapitalize === 'none' ? [textInputAutocapitalization('never')] : []),
    ...(props.autoCorrect === false ? [autocorrectionDisabled()] : []),
  ];
  const common = { text: nativeText, placeholder: props.placeholder, autoFocus: props.autoFocus, maxLength: props.maxLength, onTextChange: props.onChangeText, modifiers };
  return <SwiftUIHost style={[styles.nativeField, { height: fieldHeight }]}>{props.secureTextEntry ? <SwiftUISecureField {...common} /> : <SwiftUITextField {...common} axis={props.multiline ? 'vertical' : 'horizontal'} />}</SwiftUIHost>;
}

export function PrimaryButton({ label, onPress, disabled = false, loading = false, variant = 'primary', icon }: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean; variant?: 'primary' | 'secondary' | 'destructive' | 'plain'; icon?: string }) {
  const theme = useAppTheme();
  if (Platform.OS === 'ios' && !loading) return <SwiftUIHost style={styles.nativeButton}><SwiftUIButton label={label} systemImage={icon as never} role={variant === 'destructive' ? 'destructive' : 'default'} onPress={onPress} modifiers={[buttonStyle(variant === 'primary' ? 'glassProminent' : variant === 'plain' ? 'plain' : 'glass'), controlSize('large'), frame({ maxWidth: Infinity, minHeight: 48 }), ...(variant === 'destructive' ? [tint(theme.red)] : []), swiftUIDisabled(disabled), swiftUIAccessibilityLabel(label)]} /></SwiftUIHost>;
  const colors = variant === 'primary' ? { bg: theme.accent, text: theme.accentText } : variant === 'destructive' ? { bg: `${theme.red}18`, text: theme.red } : variant === 'plain' ? { bg: 'transparent', text: theme.blue } : { bg: theme.fillStrong, text: theme.text };
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled, busy: loading }} disabled={disabled || loading} onPress={onPress} style={({ pressed }) => [styles.button, { backgroundColor: colors.bg, opacity: disabled ? 0.42 : pressed ? 0.72 : 1 }]}>{loading ? <ActivityIndicator color={colors.text} /> : <>{icon ? <SymbolView name={icon as never} size={16} tintColor={colors.text} weight="semibold" /> : null}<Text style={[styles.buttonText, { color: colors.text }]}>{label}</Text></>}</Pressable>;
}

export function Segmented<T extends string>({ options, value, onChange }: { options: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
  const theme = useAppTheme();
  if (Platform.OS === 'ios') return <SwiftUIHost style={styles.nativeSegmented}><SwiftUIPicker label="Selection" selection={value} onSelectionChange={(selection) => onChange(selection as T)} modifiers={[pickerStyle('segmented'), frame({ maxWidth: Infinity })]}>{options.map((option) => <SwiftUIText key={option.value} modifiers={[tag(option.value)]}>{option.label}</SwiftUIText>)}</SwiftUIPicker></SwiftUIHost>;
  return <View accessibilityRole="tablist" style={[styles.segmented, { backgroundColor: theme.fillStrong }]}>{options.map((option) => <Pressable accessibilityRole="tab" accessibilityState={{ selected: value === option.value }} key={option.value} onPress={() => onChange(option.value)} style={[styles.segment, value === option.value && { backgroundColor: theme.elevated }]}><Text style={[styles.segmentText, { color: value === option.value ? theme.text : theme.secondary }]}>{option.label}</Text></Pressable>)}</View>;
}

export function NativeSwitch({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  const theme = useAppTheme();
  if (Platform.OS === 'ios') return <SwiftUIHost style={styles.nativeSwitch}><SwiftUIToggle label={label} isOn={value} onIsOnChange={onChange} modifiers={[labelsHidden(), tint(theme.green), swiftUIAccessibilityLabel(label)]} /></SwiftUIHost>;
  return null;
}

export function NativeColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  if (Platform.OS === 'ios') return <SwiftUIHost style={styles.nativeColorPicker}><SwiftUIColorPicker label={label} selection={value} supportsOpacity={false} onSelectionChange={onChange} modifiers={[frame({ maxWidth: Infinity, minHeight: 44 })]} /></SwiftUIHost>;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={() => onChange(value === '#10B981' ? '#3B82F6' : '#10B981')} style={[styles.colorFallback, { backgroundColor: value }]} />;
}

export function Badge({ label, color }: { label: string; color?: string }) {
  const theme = useAppTheme(); const tint = color ?? theme.secondary;
  return <View style={[styles.badge, { backgroundColor: `${tint}18` }]}><Text style={[styles.badgeText, { color: tint }]}>{label}</Text></View>;
}

export function EmptyState({ icon, title, detail, action }: { icon: string; title: string; detail: string; action?: ReactNode }) {
  const theme = useAppTheme();
  return <View style={styles.empty}><View style={[styles.emptyIcon, { backgroundColor: theme.fillStrong }]}><SymbolView name={icon as never} size={28} tintColor={theme.secondary} /></View><Text style={[styles.emptyTitle, { color: theme.text }]}>{title}</Text><Text style={[styles.emptyDetail, { color: theme.secondary }]}>{detail}</Text>{action}</View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, screenContent: { width: '100%', maxWidth: SETTINGS_CONTENT_MAX, alignSelf: 'center', paddingHorizontal: 18, paddingBottom: 32 }, header: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }, iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, iconButtonPlaceholder: { width: 44 }, headerCenter: { flex: 1, alignItems: 'center' }, headerTitle: { fontSize: 18, fontWeight: '700', letterSpacing: -0.35 }, headerSubtitle: { fontSize: 11, marginTop: 1 }, headerRight: { width: 44, alignItems: 'flex-end' },
  glassFill: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, pressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, overflow: 'hidden', shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } }, sectionTitleRow: { marginTop: 22, marginBottom: 8, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  row: { minHeight: 60, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 11 }, rowIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, rowText: { minWidth: 0, flex: 1 }, rowTitle: { fontSize: 15, fontWeight: '600' }, rowDetail: { fontSize: 12, marginTop: 2, lineHeight: 16 }, rowValue: { fontSize: 14 },
  fieldWrap: { gap: 6 }, fieldLabel: { marginLeft: 3, fontSize: 12, fontWeight: '600' }, field: { minHeight: 50, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, fontSize: 16 }, nativeField: { width: '100%', height: 50 }, nativePasswordField: { width: '100%', height: 52 }, passwordEye: { position: 'absolute', right: 6, top: 3, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, fieldError: { fontSize: 12, marginLeft: 3 }, nativeButton: { width: '100%', height: 50 }, button: { minHeight: 48, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, gap: 8 }, buttonText: { fontSize: 15, fontWeight: '700' },
  nativeSegmented: { width: '100%', height: 38 }, nativeSwitch: { width: 52, height: 34 }, nativeColorPicker: { width: '100%', height: 48 }, colorFallback: { width: 44, height: 44, borderRadius: 22 }, segmented: { flexDirection: 'row', borderRadius: 11, padding: 3 }, segment: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 34, borderRadius: 8 }, segmentText: { fontSize: 12, fontWeight: '700' }, badge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 }, badgeText: { fontSize: 11, fontWeight: '700' },
  empty: { paddingVertical: 58, alignItems: 'center', paddingHorizontal: 24 }, emptyIcon: { width: 58, height: 58, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginBottom: 15 }, emptyTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center' }, emptyDetail: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 6, marginBottom: 18, maxWidth: 300 },
});
