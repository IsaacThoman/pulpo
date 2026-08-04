import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { KeyboardStickyView } from 'react-native-keyboard-controller'
import { SymbolView } from 'expo-symbols'
import * as Haptics from 'expo-haptics'
import { GlassIconButton } from '../../components/PrototypeUI'
import { ModelMark } from '../../components/ModelMark'
import { useAppTheme } from '../../theme'
import type { AttachmentDraft, MobileModel } from '../../types'

export function Composer({ value, onChange, model, presets, attachments, agentMode, canUseAgent, active, onToggleAgent, onPickAttachment, onRemoveAttachment, onRetryAttachment, onOpenModels, onOpenPreset, onSend, onStop }: {
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
  onRemoveAttachment: (id: string) => void
  onRetryAttachment: (attachment: AttachmentDraft) => void
  onOpenModels: () => void
  onOpenPreset: (presetId: string) => void
  onSend: () => void
  onStop: () => void
}) {
  const theme = useAppTheme()
  const canSend = Boolean(value.trim() || attachments.some((attachment) => attachment.state === 'local' || attachment.state === 'ready'))
  return <KeyboardStickyView>
    <View style={[styles.wrap, { backgroundColor: theme.background }]}>
      <View style={[styles.composer, { backgroundColor: theme.elevated, borderColor: theme.separator, shadowColor: theme.shadow }]}>
        {attachments.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.attachments}>{attachments.map((attachment) => <Pressable key={attachment.localId} onPress={() => attachment.state === 'failed' ? onRetryAttachment(attachment) : undefined} style={[styles.attachment, { backgroundColor: theme.fillStrong }]}><SymbolView name={attachment.mimeType.startsWith('image/') ? 'photo' : 'doc'} size={15} tintColor={attachment.state === 'failed' ? theme.red : theme.secondary} /><Text numberOfLines={1} style={[styles.attachmentName, { color: theme.text }]}>{attachment.name}</Text><Text style={{ color: attachment.state === 'failed' ? theme.red : theme.secondary, fontSize: 10 }}>{attachment.state === 'uploading' ? 'Uploading' : attachment.state === 'failed' ? 'Retry' : ''}</Text><Pressable accessibilityLabel={`Remove ${attachment.name}`} onPress={() => onRemoveAttachment(attachment.localId)} hitSlop={8}><SymbolView name="xmark.circle.fill" size={15} tintColor={theme.secondary} /></Pressable></Pressable>)}</ScrollView> : null}
        <TextInput accessibilityLabel="Message" multiline maxLength={1_000_000} value={value} onChangeText={onChange} placeholder={attachments.length ? 'Add a caption…' : 'Message…'} placeholderTextColor={theme.tertiary} style={[styles.input, { color: theme.text }]} />
        <View style={styles.bar}>
          <GlassIconButton icon="plus" label="Add attachment" onPress={onPickAttachment} />
          <Pressable accessibilityRole="button" onPress={onOpenModels} style={[styles.model, { backgroundColor: theme.fillStrong }]}><ModelMark model={model} size={22} /><Text numberOfLines={1} style={[styles.modelName, { color: theme.text }]}>{model?.name ?? 'Choose model'}</Text><SymbolView name="chevron.up.chevron.down" size={11} tintColor={theme.secondary} /></Pressable>
          <View style={{ flex: 1 }} />
          {canUseAgent ? <Pressable accessibilityRole="switch" accessibilityState={{ checked: agentMode }} accessibilityLabel="Agent mode" onPress={() => { void Haptics.selectionAsync(); onToggleAgent() }} style={[styles.circle, { backgroundColor: agentMode ? theme.accent : theme.fillStrong }]}><SymbolView name="shippingbox" size={15} tintColor={agentMode ? theme.accentText : theme.secondary} /></Pressable> : null}
          <Pressable accessibilityRole="button" accessibilityLabel={active ? 'Stop generating' : 'Send message'} disabled={!active && !canSend} onPress={() => active ? onStop() : onSend()} style={[styles.send, { backgroundColor: theme.accent, opacity: !active && !canSend ? 0.35 : 1 }]}><SymbolView name={active ? 'stop.fill' : 'arrow.up'} size={14} tintColor={theme.accentText} weight="bold" /></Pressable>
        </View>
        {model?.presets.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presets}>{model.presets.map((preset) => {
          const choice = preset.choices.find((item) => item.id === presets[preset.id]) ?? preset.choices[0]
          return <Pressable key={preset.id} onPress={() => onOpenPreset(preset.id)} style={[styles.preset, { backgroundColor: theme.fillStrong }]}><Text style={[styles.presetText, { color: theme.secondary }]}>{preset.name}: {choice?.displayName}</Text><SymbolView name="chevron.down" size={9} tintColor={theme.secondary} /></Pressable>
        })}</ScrollView> : null}
      </View>
    </View>
  </KeyboardStickyView>
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingTop: 7, paddingBottom: 10 }, composer: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 24, padding: 8, shadowOpacity: 0.12, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } }, input: { minHeight: 43, maxHeight: 160, fontSize: 16, lineHeight: 22, paddingHorizontal: 8, paddingVertical: 9 }, bar: { height: 45, flexDirection: 'row', alignItems: 'center', gap: 7 }, model: { maxWidth: 170, minHeight: 38, borderRadius: 19, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 6 }, modelName: { maxWidth: 102, fontSize: 12, fontWeight: '700' }, circle: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' }, send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' }, attachments: { gap: 7, paddingBottom: 6 }, attachment: { maxWidth: 230, minHeight: 38, borderRadius: 12, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 6 }, attachmentName: { maxWidth: 125, fontSize: 11, fontWeight: '600' }, presets: { gap: 6, paddingHorizontal: 4, paddingTop: 2, paddingBottom: 3 }, preset: { minHeight: 28, borderRadius: 14, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5 }, presetText: { fontSize: 11, fontWeight: '600' },
})
