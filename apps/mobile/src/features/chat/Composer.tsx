import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useColorScheme, View } from 'react-native'
import { KeyboardStickyView } from 'react-native-keyboard-controller'
import { SymbolView } from 'expo-symbols'
import { GlassView } from 'expo-glass-effect'
import * as Haptics from 'expo-haptics'
import { Button as SwiftUIButton, Host as SwiftUIHost, Image as SwiftUIImage, Menu as SwiftUIMenu } from '@expo/ui/swift-ui'
import { accessibilityLabel, buttonBorderShape, buttonStyle, controlSize, disabled, foregroundStyle, labelStyle, tint } from '@expo/ui/swift-ui/modifiers'
import { GlassIconButton } from '../../components/PrototypeUI'
import { useAppTheme } from '../../theme'
import type { AttachmentDraft, MobileModel } from '../../types'

function NativeComposerIconButton({ label, systemImage, onPress, isDisabled = false, prominent = false }: {
  label: string
  systemImage: string
  onPress: () => void
  isDisabled?: boolean
  prominent?: boolean
}) {
  const colorScheme = useColorScheme()
  const prominentTint = colorScheme === 'dark' ? '#f2f2f7' : '#1c1c1e'
  const prominentForeground = colorScheme === 'dark' ? '#1c1c1e' : '#ffffff'
  if (Platform.OS !== 'ios') return null
  return <SwiftUIHost ignoreSafeArea="keyboard" style={styles.nativeCircle}>
    <SwiftUIButton label={label} systemImage={systemImage as never} onPress={onPress} modifiers={[
      buttonStyle(prominent ? 'glassProminent' : 'glass'), buttonBorderShape('circle'), controlSize('regular'), labelStyle('iconOnly'),
      ...(prominent ? [tint(prominentTint), foregroundStyle(prominentForeground)] : []), disabled(isDisabled), accessibilityLabel(label),
    ]} />
  </SwiftUIHost>
}

function NativeAttachmentMenu({ onPickPhotos, onPickFiles }: { onPickPhotos: () => void; onPickFiles: () => void }) {
  return <SwiftUIHost ignoreSafeArea="keyboard" style={styles.nativeCircle}>
    <SwiftUIMenu
      label={<SwiftUIImage systemName="plus" size={18} />}
      modifiers={[buttonStyle('glass'), buttonBorderShape('circle'), controlSize('regular'), accessibilityLabel('Add attachment')]}
    >
      <SwiftUIButton label="Photo Library" systemImage="photo.on.rectangle" onPress={onPickPhotos} />
      <SwiftUIButton label="Choose Files" systemImage="doc" onPress={onPickFiles} />
    </SwiftUIMenu>
  </SwiftUIHost>
}

function NativePresetMenu({ preset, selectedId, onSelect }: {
  preset: MobileModel['presets'][number]
  selectedId?: string
  onSelect: (choiceId: string) => void
}) {
  const selected = preset.choices.find((choice) => choice.id === selectedId) ?? preset.choices[0]
  return <SwiftUIHost ignoreSafeArea="keyboard" matchContents style={styles.nativePreset}>
    <SwiftUIMenu
      label={selected?.displayName ?? preset.name}
      modifiers={[buttonStyle('glass'), buttonBorderShape('capsule'), controlSize('regular'), accessibilityLabel(`${preset.name}, ${selected?.displayName ?? 'Default'}`)]}
    >
      {preset.choices.map((choice) => <SwiftUIButton key={choice.id} label={choice.displayName} systemImage={choice.id === selected?.id ? 'checkmark' : undefined} onPress={() => onSelect(choice.id)} />)}
    </SwiftUIMenu>
  </SwiftUIHost>
}

export function Composer({ value, onChange, model, presets, attachments, agentMode, canUseAgent, active, onToggleAgent, onPickAttachment, onPickPhotos, onPickFiles, onRemoveAttachment, onRetryAttachment, onOpenPreset, onSelectPreset, onSend, onStop }: {
  value: string
  onChange: (value: string) => void
  model?: MobileModel
  presets: Record<string, string>
  attachments: AttachmentDraft[]
  agentMode: boolean
  canUseAgent: boolean
  active: boolean
  onToggleAgent: () => void
  onPickAttachment: () => void
  onPickPhotos: () => void
  onPickFiles: () => void
  onRemoveAttachment: (id: string) => void
  onRetryAttachment: (attachment: AttachmentDraft) => void
  onOpenPreset: (presetId: string) => void
  onSelectPreset: (presetId: string, choiceId: string) => void
  onSend: () => void
  onStop: () => void
}) {
  const theme = useAppTheme()
  const canSend = Boolean(value.trim() || attachments.some((attachment) => attachment.state === 'local' || attachment.state === 'ready'))
  return <KeyboardStickyView>
    <View style={[styles.wrap, { backgroundColor: theme.background }]}>
      <View style={[styles.composer, { backgroundColor: theme.elevated, borderColor: theme.separator, shadowColor: theme.shadow }]}>
        {attachments.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attachments}>{attachments.map((attachment) => <View key={attachment.localId} style={styles.attachmentFrame}><Pressable onPress={() => attachment.state === 'failed' ? onRetryAttachment(attachment) : undefined} style={[attachment.mimeType.startsWith('image/') ? styles.imageAttachment : styles.fileAttachment, { backgroundColor: theme.fillStrong }]}>{attachment.mimeType.startsWith('image/') ? <Image source={{ uri: attachment.uri }} style={styles.attachmentImage} /> : <><View style={[styles.fileIcon, { backgroundColor: theme.fill }]}><SymbolView name="doc.fill" size={22} tintColor={attachment.state === 'failed' ? theme.red : theme.secondary} /></View><View style={{ flex: 1 }}><Text numberOfLines={1} style={[styles.attachmentName, { color: theme.text }]}>{attachment.name}</Text><Text style={{ color: attachment.state === 'failed' ? theme.red : theme.secondary, fontSize: 10.5 }}>{attachment.state === 'uploading' ? 'Uploading' : attachment.state === 'failed' ? 'Tap to retry' : ''}</Text></View></>}</Pressable><Pressable accessibilityLabel={`Remove ${attachment.name}`} onPress={() => onRemoveAttachment(attachment.localId)} hitSlop={8} style={styles.removeAttachment}><SymbolView name="xmark.circle.fill" size={20} tintColor="#3a3a3c" /></Pressable></View>)}</ScrollView> : null}
        <TextInput accessibilityLabel="Message" multiline maxLength={1_000_000} value={value} onChangeText={onChange} placeholder={attachments.length ? 'Add a caption…' : 'Message…'} placeholderTextColor={theme.tertiary} style={[styles.input, { color: theme.text }]} />
        <View style={styles.bar}>
          {Platform.OS === 'ios' ? <NativeAttachmentMenu onPickFiles={onPickFiles} onPickPhotos={onPickPhotos} /> : <GlassIconButton icon="plus" label="Add attachment" onPress={onPickAttachment} />}
          {model?.presets.map((preset) => {
            const choice = preset.choices.find((item) => item.id === presets[preset.id]) ?? preset.choices[0]
            if (Platform.OS === 'ios') return <NativePresetMenu key={preset.id} preset={preset} selectedId={choice?.id} onSelect={(choiceId) => onSelectPreset(preset.id, choiceId)} />
            return <Pressable accessibilityRole="button" key={preset.id} onPress={() => onOpenPreset(preset.id)}><GlassView isInteractive style={styles.preset}><Text style={[styles.presetText, { color: theme.secondary }]}>{choice?.displayName ?? preset.name}</Text></GlassView></Pressable>
          })}
          <View style={{ flex: 1 }} />
          <Pressable accessibilityRole="switch" accessibilityState={{ checked: agentMode, disabled: !canUseAgent }} accessibilityLabel="Agent mode" disabled={!canUseAgent} onPress={() => { void Haptics.selectionAsync(); onToggleAgent() }}><GlassView isInteractive style={[styles.circle, { backgroundColor: agentMode ? '#AF52DE' : 'transparent', opacity: canUseAgent ? 1 : 0.42 }]}><SymbolView name="shippingbox" size={15} tintColor={agentMode ? '#ffffff' : theme.secondary} /></GlassView></Pressable>
          {Platform.OS === 'ios' ? <NativeComposerIconButton label={active ? 'Stop generating' : 'Send message'} systemImage={active ? 'stop.fill' : 'arrow.up'} isDisabled={!active && !canSend} onPress={() => active ? onStop() : onSend()} prominent /> : <Pressable accessibilityRole="button" accessibilityLabel={active ? 'Stop generating' : 'Send message'} disabled={!active && !canSend} onPress={() => active ? onStop() : onSend()} style={[styles.send, { backgroundColor: theme.accent, opacity: !active && !canSend ? 0.35 : 1 }]}><SymbolView name={active ? 'stop.fill' : 'arrow.up'} size={14} tintColor={theme.accentText} weight="bold" /></Pressable>}
        </View>
      </View>
    </View>
  </KeyboardStickyView>
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 10 }, composer: { minHeight: 108, borderWidth: StyleSheet.hairlineWidth, borderRadius: 28, paddingTop: 12, paddingHorizontal: 10, paddingBottom: 4, shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } }, input: { minHeight: 30, maxHeight: 120, fontSize: 16, lineHeight: 22, paddingHorizontal: 5, paddingTop: 0, paddingBottom: 0 }, bar: { flexDirection: 'row', alignItems: 'center', marginTop: 'auto', gap: 1 }, nativeCircle: { width: 44, height: 44 }, nativePreset: { minWidth: 72, height: 44 }, circle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }, attachments: { gap: 8, paddingHorizontal: 2, paddingBottom: 8 }, attachmentFrame: { paddingTop: 17, paddingRight: 17 }, imageAttachment: { width: 72, height: 72, borderRadius: 14, overflow: 'hidden' }, attachmentImage: { width: 72, height: 72, borderRadius: 14 }, fileAttachment: { width: 174, height: 72, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 11 }, fileIcon: { width: 32, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }, attachmentName: { fontSize: 12.5, fontWeight: '600' }, removeAttachment: { position: 'absolute', top: 0, right: 0, width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }, preset: { minHeight: 44, borderRadius: 22, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center' }, presetText: { fontSize: 12.5, fontWeight: '500' },
})
