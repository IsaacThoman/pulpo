import { useState } from 'react'
import { AccessibilityInfo, Pressable, Share, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import * as Haptics from 'expo-haptics'
import { SymbolView } from 'expo-symbols'
import { NativeContextMenu, type ContextAction } from '../../components/NativeContextMenu'
import { ModelMark } from '../../components/ModelMark'
import { SafeMarkdown } from '../../components/SafeMarkdown'
import { usePreferencesStore } from '../../store/preferences'
import { useAppTheme } from '../../theme'
import type { MobileModel } from '../../types'
import type { DisplayAttachment, DisplayMessage } from './projection'

function formatBytes(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function BranchControl({ branch, onSelect }: { branch: DisplayMessage['branch']; onSelect: (id: string) => void }) {
  const theme = useAppTheme()
  if (branch.ids.length <= 1) return null
  const previous = branch.ids[Math.max(0, branch.index - 1)]
  const next = branch.ids[Math.min(branch.ids.length - 1, branch.index + 1)]
  return <View style={styles.branch}>
    <Pressable accessibilityLabel="Previous branch" disabled={branch.index <= 0} onPress={() => previous && onSelect(previous)}><SymbolView name="chevron.left" size={13} tintColor={branch.index <= 0 ? theme.tertiary : theme.secondary} /></Pressable>
    <Text style={[styles.branchText, { color: theme.secondary }]}>{branch.index + 1} / {branch.ids.length}</Text>
    <Pressable accessibilityLabel="Next branch" disabled={branch.index >= branch.ids.length - 1} onPress={() => next && onSelect(next)}><SymbolView name="chevron.right" size={13} tintColor={branch.index >= branch.ids.length - 1 ? theme.tertiary : theme.secondary} /></Pressable>
  </View>
}

function AttachmentChip({ attachment, onOpen }: { attachment: DisplayAttachment; onOpen: (attachment: DisplayAttachment) => void }) {
  const theme = useAppTheme()
  return <Pressable onPress={() => onOpen(attachment)} style={[styles.attachment, { borderColor: theme.separator, backgroundColor: theme.fill }]}>
    <View style={[styles.attachmentIcon, { backgroundColor: theme.fillStrong }]}><SymbolView name={attachment.mimeType.startsWith('image/') ? 'photo' : 'doc'} size={18} tintColor={theme.secondary} /></View>
    <View style={{ flex: 1 }}><Text numberOfLines={1} style={[styles.attachmentName, { color: theme.text }]}>{attachment.name}</Text><Text style={[styles.attachmentMeta, { color: theme.secondary }]}>{attachment.generated ? 'Generated file' : 'Attachment'}{attachment.sizeBytes ? ` · ${formatBytes(attachment.sizeBytes)}` : ''}</Text></View>
    <SymbolView name="square.and.arrow.down" size={15} tintColor={theme.secondary} />
  </Pressable>
}

export function MessageItem({ message, model, onReply, onEdit, onRegenerate, onDelete, onActivateBranch, onOpenAttachment, onContinueWithoutAgent }: {
  message: DisplayMessage
  model?: MobileModel
  onReply: (text: string) => void
  onEdit: (message: DisplayMessage) => void
  onRegenerate: (message: DisplayMessage) => void
  onDelete: (message: DisplayMessage) => void
  onActivateBranch: (id: string) => void
  onOpenAttachment: (attachment: DisplayAttachment) => void
  onContinueWithoutAgent: (message: DisplayMessage) => void
}) {
  const theme = useAppTheme()
  const showReasoningPreference = usePreferencesStore((state) => state.showReasoning)
  const [reasoningOpen, setReasoningOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(true)
  const copy = async () => {
    await Clipboard.setStringAsync(message.text)
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    AccessibilityInfo.announceForAccessibility('Message copied')
  }
  const actions: Array<ContextAction | 'divider'> = [
    { label: 'Copy', systemImage: 'doc.on.doc', grouped: true, onPress: () => { void copy() } },
    { label: 'Share', systemImage: 'square.and.arrow.up', grouped: true, onPress: () => { void Share.share({ message: message.text }) } },
    { label: 'Reply', systemImage: 'arrowshape.turn.up.left', grouped: true, onPress: () => onReply(message.text) },
    'divider',
    message.role === 'user'
      ? { label: 'Edit message', systemImage: 'pencil', onPress: () => onEdit(message) }
      : { label: 'Regenerate response', systemImage: 'arrow.clockwise', onPress: () => onRegenerate(message) },
    { label: 'Delete message', systemImage: 'trash', destructive: true, onPress: () => onDelete(message) },
  ]
  if (message.role === 'user') return <View style={styles.userWrap}>
    {message.attachments.map((attachment) => <AttachmentChip key={attachment.id} attachment={attachment} onOpen={onOpenAttachment} />)}
    <NativeContextMenu actions={actions} style={styles.userMenu}>
      <View style={[styles.userBubble, { backgroundColor: theme.elevated }]}><Text selectable style={[styles.userText, { color: theme.text }]}>{message.text}</Text></View>
    </NativeContextMenu>
    <BranchControl branch={message.branch} onSelect={onActivateBranch} />
  </View>

  const active = message.status === 'queued' || message.status === 'in_progress'
  return <View style={styles.assistantWrap}>
    <View style={styles.assistantHeader}><ModelMark model={model} size={27} /><Text style={[styles.modelName, { color: theme.text }]}>{model?.name ?? message.modelId}</Text>{active ? <Text accessibilityLiveRegion="polite" style={[styles.working, { color: theme.secondary }]}>Working…</Text> : null}</View>
    {showReasoningPreference && message.reasoning ? <Pressable onPress={() => setReasoningOpen((current) => !current)} style={[styles.disclosure, { borderColor: theme.separator }]}>
      <View style={styles.disclosureTitle}><SymbolView name="brain.head.profile" size={15} tintColor={theme.secondary} /><Text style={[styles.disclosureLabel, { color: theme.secondary }]}>Reasoning</Text><SymbolView name={reasoningOpen ? 'chevron.up' : 'chevron.down'} size={11} tintColor={theme.secondary} /></View>
      {reasoningOpen ? <Text selectable style={[styles.reasoning, { color: theme.secondary }]}>{message.reasoning}</Text> : null}
    </Pressable> : null}
    {message.activity.length ? <View style={[styles.activity, { borderColor: theme.separator }]}>
      <Pressable onPress={() => setActivityOpen((current) => !current)} style={styles.disclosureTitle}><SymbolView name="hammer" size={15} tintColor={theme.secondary} /><Text style={[styles.disclosureLabel, { color: theme.secondary }]}>Activity</Text><Text style={[styles.activityCount, { color: theme.secondary }]}>{message.activity.length}</Text><SymbolView name={activityOpen ? 'chevron.up' : 'chevron.down'} size={11} tintColor={theme.secondary} /></Pressable>
      {activityOpen ? message.activity.map((item) => <View key={item.id} style={styles.activityRow}><SymbolView name={item.kind === 'workspace' ? 'shippingbox' : item.status === 'failed' ? 'exclamationmark.triangle' : 'terminal'} size={15} tintColor={item.status === 'failed' ? theme.red : theme.secondary} /><View style={{ flex: 1 }}><Text style={[styles.activityTitle, { color: theme.text }]}>{item.title}</Text>{item.detail ? <Text numberOfLines={4} style={[styles.activityDetail, { color: theme.secondary }]}>{item.detail}</Text> : null}</View></View>) : null}
    </View> : null}
    <NativeContextMenu actions={actions} style={styles.assistantMenu}>
      <View>{message.text ? <SafeMarkdown>{message.text}</SafeMarkdown> : active ? <Text style={[styles.placeholder, { color: theme.secondary }]}>Pulpo is preparing a response…</Text> : null}</View>
    </NativeContextMenu>
    {message.error ? <View style={[styles.error, { backgroundColor: `${theme.red}14`, borderColor: `${theme.red}44` }]}><SymbolView name="exclamationmark.triangle.fill" size={16} tintColor={theme.red} /><View style={{ flex: 1 }}><Text style={[styles.errorTitle, { color: theme.red }]}>Response failed</Text><Text style={[styles.errorText, { color: theme.secondary }]}>{message.error}</Text></View><Pressable onPress={() => onRegenerate(message)}><Text style={{ color: theme.blue, fontWeight: '700' }}>Retry</Text></Pressable></View> : null}
    {message.agentMode && active && message.activity.some((item) => item.kind === 'workspace' && ['waiting', 'unavailable'].includes(item.status)) ? <Pressable onPress={() => onContinueWithoutAgent(message)} style={[styles.continueButton, { backgroundColor: theme.fillStrong }]}><Text style={{ color: theme.text, fontWeight: '700' }}>Continue without agent tools</Text></Pressable> : null}
    {message.attachments.map((attachment) => <AttachmentChip key={attachment.id} attachment={attachment} onOpen={onOpenAttachment} />)}
    {!active && message.usage ? <Text style={[styles.meta, { color: theme.tertiary }]}>{message.usage.inputTokens.toLocaleString()} → {message.usage.outputTokens.toLocaleString()} tokens</Text> : null}
    <BranchControl branch={message.branch} onSelect={onActivateBranch} />
  </View>
}

const styles = StyleSheet.create({
  userWrap: { alignItems: 'flex-end', marginBottom: 24, gap: 8 }, userMenu: { maxWidth: '88%' }, userBubble: { borderRadius: 20, borderBottomRightRadius: 7, paddingHorizontal: 15, paddingVertical: 11 }, userText: { fontSize: 16, lineHeight: 23 }, assistantWrap: { marginBottom: 30, gap: 10 }, assistantHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 }, modelName: { fontSize: 13, fontWeight: '700' }, working: { fontSize: 12, marginLeft: 2 }, assistantMenu: { alignSelf: 'stretch' }, placeholder: { fontSize: 15, paddingVertical: 4 },
  disclosure: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 11, gap: 9 }, disclosureTitle: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 7 }, disclosureLabel: { fontSize: 12, fontWeight: '700', flex: 1 }, reasoning: { fontSize: 13, lineHeight: 19 }, activity: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 14, padding: 11, gap: 8 }, activityCount: { fontSize: 11 }, activityRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, paddingVertical: 5 }, activityTitle: { fontSize: 13, fontWeight: '600' }, activityDetail: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  attachment: { minWidth: 230, maxWidth: '100%', borderWidth: StyleSheet.hairlineWidth, borderRadius: 15, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 9 }, attachmentIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }, attachmentName: { fontSize: 13, fontWeight: '700' }, attachmentMeta: { fontSize: 11, marginTop: 2 },
  error: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 15, padding: 11, flexDirection: 'row', alignItems: 'flex-start', gap: 9 }, errorTitle: { fontSize: 13, fontWeight: '700' }, errorText: { fontSize: 12, lineHeight: 17, marginTop: 2 }, continueButton: { minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, meta: { fontSize: 11 }, branch: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 26 }, branchText: { fontSize: 11 },
})
