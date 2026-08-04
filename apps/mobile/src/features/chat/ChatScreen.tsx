import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AccessibilityInfo, Alert, FlatList, Image, Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import * as Crypto from 'expo-crypto'
import * as DocumentPicker from 'expo-document-picker'
import * as ImagePicker from 'expo-image-picker'
import * as Haptics from 'expo-haptics'
import { File } from 'expo-file-system'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiRequest, mobileApi } from '../../api/client'
import { GlassIconButton } from '../../components/PrototypeUI'
import { ModelMark } from '../../components/ModelMark'
import { cacheNamespace, loadDraft, saveDraft } from '../../data/database'
import { chatQuery, queryKeys } from '../../data/queries'
import { useRealtimeStore, subscribeToChat, subscribeToResponse } from '../../providers/RealtimeProvider'
import { usePreferencesStore } from '../../store/preferences'
import { useSessionStore } from '../../store/session'
import { useAppTheme } from '../../theme'
import type { AttachmentDraft, MobileModel, ServerChat } from '../../types'
import {
  activateBranch,
  cancelResponse,
  continueWithoutAgent,
  createChat,
  deleteMessageCascade,
  downloadAttachment,
  duplicateChat,
  editMessage,
  regenerateResponse,
  sendMessage,
  shareAttachment,
  shareChat,
  trashChat,
  updateChat,
  uploadAttachment,
} from './api'
import { Composer } from './Composer'
import { MessageItem } from './MessageItem'
import { ModelPicker } from './ModelPicker'
import { projectChat, type DisplayAttachment, type DisplayMessage } from './projection'

const SUGGESTIONS = [
  'What can you help me build today?',
  'Explain a difficult idea clearly',
  'Review this plan for blind spots',
  'Draft a concise project update',
]

function defaultSelections(model: MobileModel | undefined): Record<string, string> {
  return Object.fromEntries((model?.presets ?? []).flatMap((preset) => {
    const choice = preset.defaultChoiceId ?? preset.choices[0]?.id
    return choice ? [[preset.id, choice]] : []
  }))
}

function localAttachment(asset: { uri: string; name?: string | null; fileName?: string | null; mimeType?: string | null; size?: number | null; fileSize?: number | null }): AttachmentDraft {
  const file = new File(asset.uri)
  return {
    localId: Crypto.randomUUID(),
    name: asset.name ?? asset.fileName ?? file.name ?? 'attachment',
    uri: asset.uri,
    mimeType: asset.mimeType ?? 'application/octet-stream',
    sizeBytes: asset.size ?? asset.fileSize ?? file.size,
    state: 'local',
  }
}

export function ChatScreen({ chatId }: { chatId?: string }) {
  const theme = useAppTheme()
  const queryClient = useQueryClient()
  const user = useSessionStore((state) => state.user)!
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  const namespace = cacheNamespace(instanceUrl, user.id)
  const defaultModelId = usePreferencesStore((state) => state.defaultModelId)
  const preferenceAgentMode = usePreferencesStore((state) => state.agentMode)
  const setPreference = usePreferencesStore((state) => state.setPreference)
  const [createdChatId, setCreatedChatId] = useState<string | null>(chatId ?? null)
  const activeChatId = chatId ?? createdChatId
  const { data: modelResult } = useQuery({ queryKey: queryKeys.models(namespace), queryFn: mobileApi.models })
  const models = modelResult?.data ?? []
  const { data: chat, isLoading, error } = useQuery({ ...chatQuery(namespace, activeChatId ?? ''), enabled: Boolean(activeChatId) })
  const liveSnapshots = useRealtimeStore((state) => state.snapshots)
  const messages = useMemo(() => chat ? projectChat(chat, liveSnapshots) : [], [chat, liveSnapshots])
  const [modelId, setModelId] = useState<string | null>(null)
  const selectedModel = models.find((model) => model.id === modelId) ?? models.find((model) => model.id === chat?.modelId) ?? models.find((model) => model.id === defaultModelId) ?? models[0]
  const [presetSelections, setPresetSelections] = useState<Record<string, string>>({})
  const [agentMode, setAgentMode] = useState(preferenceAgentMode)
  const [temporary, setTemporary] = useState(false)
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<AttachmentDraft[]>([])
  const [modelPicker, setModelPicker] = useState(false)
  const [pendingText, setPendingText] = useState<string | null>(null)
  const [pendingResponseId, setPendingResponseId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const draftLoaded = useRef(false)
  const listRef = useRef<FlatList<DisplayMessage>>(null)

  useEffect(() => {
    if (!selectedModel || modelId) return
    setModelId(selectedModel.id)
    setPresetSelections(defaultSelections(selectedModel))
  }, [modelId, selectedModel])

  useEffect(() => {
    if (!chat?.responses) return
    for (const response of chat.responses) useRealtimeStore.getState().receiveSnapshot(response.snapshot)
  }, [chat?.responses])

  useEffect(() => {
    if (!activeChatId) return
    return subscribeToChat(activeChatId)
  }, [activeChatId])

  const activeResponse = messages.findLast((message) => message.role === 'assistant' && ['queued', 'in_progress'].includes(message.status))
  const activeResponseId = activeResponse?.responseId
  useEffect(() => {
    if (!activeResponseId) return
    const sequence = useRealtimeStore.getState().snapshots[activeResponseId]?.sequence ?? 0
    return subscribeToResponse(activeResponseId, sequence)
  }, [activeResponseId])

  useEffect(() => {
    const key = activeChatId ?? 'new'
    void loadDraft<AttachmentDraft>(namespace, key).then((draft) => {
      if (draft) { setInput(draft.body); setAttachments(draft.attachments) }
      draftLoaded.current = true
    })
  }, [activeChatId, namespace])

  useEffect(() => {
    if (!draftLoaded.current) return
    const timeout = setTimeout(() => { void saveDraft(namespace, activeChatId ?? 'new', input, attachments) }, 350)
    return () => clearTimeout(timeout)
  }, [activeChatId, attachments, input, namespace])

  useEffect(() => {
    if (pendingResponseId && chat?.responses?.some((response) => response.id === pendingResponseId)) {
      setPendingText(null)
      setPendingResponseId(null)
    }
  }, [chat?.responses, pendingResponseId])

  const invalidate = useCallback(async (id = activeChatId) => {
    if (!id) return
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.chat(namespace, id) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) }),
    ])
  }, [activeChatId, namespace, queryClient])

  const pickFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true })
    if (!result.canceled) setAttachments((current) => [...current, ...result.assets.map(localAttachment)])
  }
  const pickPhotos = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) return Alert.alert('Photos access is off', 'Allow access in Settings to attach photos.')
    const result = await ImagePicker.launchImageLibraryAsync({ allowsMultipleSelection: true, mediaTypes: ['images'], quality: 1 })
    if (!result.canceled) setAttachments((current) => [...current, ...result.assets.map(localAttachment)])
  }
  const chooseAttachment = () => Alert.alert('Add attachment', undefined, [
    { text: 'Photo Library', onPress: () => { void pickPhotos() } },
    { text: 'Files', onPress: () => { void pickFiles() } },
    { text: 'Cancel', style: 'cancel' },
  ])
  const uploadOne = async (draft: AttachmentDraft, id: string): Promise<AttachmentDraft> => {
    setAttachments((current) => current.map((item) => item.localId === draft.localId ? { ...item, state: 'uploading', error: undefined } : item))
    try {
      const uploaded = await uploadAttachment(draft, id)
      const ready: AttachmentDraft = { ...draft, serverId: uploaded.id, state: 'ready', error: undefined }
      setAttachments((current) => current.map((item) => item.localId === draft.localId ? ready : item))
      return ready
    } catch (cause) {
      const failed: AttachmentDraft = { ...draft, state: 'failed', error: cause instanceof Error ? cause.message : 'Upload failed' }
      setAttachments((current) => current.map((item) => item.localId === draft.localId ? failed : item))
      throw cause
    }
  }

  const submit = async (override?: string) => {
    if (!selectedModel || sending) return
    const content = (override ?? input).trim()
    if (!content && !attachments.length) return
    setSending(true)
    try {
      const currentChat = activeChatId ? chat ?? await apiRequest<ServerChat>(`/api/chats/${activeChatId}`) : await createChat({ modelId: selectedModel.id, temporary })
      if (!activeChatId) {
        setCreatedChatId(currentChat.id)
        router.replace({ pathname: '/(member)/chat/[id]', params: { id: currentChat.id } })
      }
      const ready: AttachmentDraft[] = []
      for (const attachment of attachments) ready.push(attachment.serverId ? attachment : await uploadOne(attachment, currentChat.id))
      setPendingText(content)
      setInput(''); setAttachments([])
      await saveDraft(namespace, activeChatId ?? 'new', '', [])
      const snapshot = await sendMessage({
        chatId: currentChat.id, content, modelId: selectedModel.id,
        parentResponseId: currentChat.activeBranchLeafId ?? currentChat.activeResponseId,
        presetSelections, attachmentIds: ready.flatMap((attachment) => attachment.serverId ? [attachment.serverId] : []), agentMode,
      })
      setPendingResponseId(snapshot.responseId)
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      await invalidate(currentChat.id)
    } catch (cause) {
      setPendingText(null)
      setPendingResponseId(null)
      Alert.alert('Could not send message', cause instanceof Error ? cause.message : undefined)
    } finally { setSending(false) }
  }

  const stop = async () => {
    if (!activeResponse) return
    await cancelResponse(activeResponse.responseId).catch((cause) => Alert.alert('Could not stop', cause instanceof Error ? cause.message : undefined))
    await invalidate()
  }
  const selectModel = (model: MobileModel) => {
    setModelId(model.id); setPresetSelections(defaultSelections(model)); setModelPicker(false)
    if (activeChatId) void updateChat(activeChatId, { modelId: model.id }).then(() => invalidate())
  }
  const openPreset = (presetId: string) => {
    const preset = selectedModel?.presets.find((item) => item.id === presetId)
    if (!preset) return
    Alert.alert(preset.name, undefined, [
      ...preset.choices.map((choice) => ({ text: `${choice.id === presetSelections[preset.id] ? '✓ ' : ''}${choice.displayName}`, onPress: () => setPresetSelections((current) => ({ ...current, [preset.id]: choice.id })) })),
      { text: 'Cancel', style: 'cancel' as const },
    ])
  }
  const edit = (message: DisplayMessage) => Platform.OS === 'ios' && Alert.prompt('Edit message', message.role === 'user' ? 'Saving resends from this point.' : 'Saving creates a response branch.', (value) => {
    const content = value.trim(); if (!content) return
    void editMessage(message.id, content, selectedModel?.id, presetSelections).then(() => invalidate()).catch((cause) => Alert.alert('Could not edit message', cause instanceof Error ? cause.message : undefined))
  }, 'plain-text', message.text)
  const regenerate = (message: DisplayMessage) => {
    void regenerateResponse(message.responseId, selectedModel?.id, presetSelections).then(() => invalidate()).catch((cause) => Alert.alert('Could not regenerate', cause instanceof Error ? cause.message : undefined))
  }
  const remove = (message: DisplayMessage) => Alert.alert('Delete message?', 'This message and its later branch will be removed.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => void deleteMessageCascade(message.id).then(() => invalidate()).catch((cause) => Alert.alert('Could not delete message', cause instanceof Error ? cause.message : undefined)) },
  ])
  const activate = (id: string) => { void activateBranch(id).then(() => invalidate()).catch(() => undefined) }
  const openAttachment = (attachment: DisplayAttachment) => Alert.alert(attachment.name, undefined, [
    { text: 'Save to cache', onPress: () => void downloadAttachment(attachment.id, attachment.name).then(() => AccessibilityInfo.announceForAccessibility('File saved')).catch((cause) => Alert.alert('Could not save file', cause instanceof Error ? cause.message : undefined)) },
    { text: 'Share', onPress: () => void shareAttachment(attachment.id, attachment.name, attachment.mimeType).catch((cause) => Alert.alert('Could not share file', cause instanceof Error ? cause.message : undefined)) },
    { text: 'Cancel', style: 'cancel' },
  ])
  const shareCurrent = async () => {
    if (!activeChatId) return
    try { const url = await shareChat(activeChatId); await Share.share({ message: `${chat?.title ?? 'Pulpo chat'}\n${url}`, url }) }
    catch (cause) { Alert.alert('Could not share chat', cause instanceof Error ? cause.message : undefined) }
  }
  const chatActions = () => Alert.alert(chat?.title ?? 'New chat', undefined, [
    ...(!activeChatId ? [{ text: temporary ? 'Use chat history' : 'Make temporary', onPress: () => setTemporary((current) => !current) }] : []),
    ...(activeChatId ? [{ text: 'Share', onPress: () => { void shareCurrent() } }, { text: 'Rename', onPress: () => Platform.OS === 'ios' && Alert.prompt('Rename chat', undefined, (title) => title.trim() && void updateChat(activeChatId, { title: title.trim() }).then(() => invalidate()), 'plain-text', chat?.title) }, { text: 'Duplicate', onPress: () => void duplicateChat(activeChatId).then((copy) => router.push({ pathname: '/(member)/chat/[id]', params: { id: copy.id } })) }, { text: 'Move to Trash', style: 'destructive' as const, onPress: () => void trashChat(activeChatId).then(() => { void queryClient.invalidateQueries({ queryKey: queryKeys.chats(namespace) }); router.replace('/(member)') }) }] : []),
    { text: 'Cancel', style: 'cancel' },
  ])

  const displayMessages = messages
  const active = Boolean(activeResponse || sending)
  return <View style={[styles.root, { backgroundColor: theme.background }]}>
    <SafeAreaView edges={['top']} style={{ backgroundColor: theme.background }}>
      <View style={styles.header}>
        <GlassIconButton icon="sidebar.left" label="Chats" onPress={() => router.back()} />
        <Pressable accessibilityRole="button" onPress={() => setModelPicker(true)} style={styles.headerTitle}><Text numberOfLines={1} style={[styles.title, { color: theme.text }]}>{chat?.title ?? (temporary ? 'Temporary chat' : 'New chat')}</Text><Text numberOfLines={1} style={[styles.subtitle, { color: theme.secondary }]}>{selectedModel?.name ?? 'Choose a model'}</Text></Pressable>
        <GlassIconButton icon="ellipsis" label="Chat actions" onPress={chatActions} />
      </View>
    </SafeAreaView>
    {error ? <View style={styles.center}><Text style={{ color: theme.red }}>{error instanceof Error ? error.message : 'Could not load chat'}</Text></View> : null}
    <FlatList
      ref={listRef}
      data={displayMessages}
      keyExtractor={(message) => message.id}
      contentContainerStyle={[styles.messages, !displayMessages.length && styles.emptyMessages]}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
      ListEmptyComponent={!isLoading ? <View style={styles.empty}>
        <View style={styles.modelTitle}><ModelMark model={selectedModel} size={48} /><Text style={[styles.emptyTitle, { color: theme.text }]}>{selectedModel?.name ?? 'Pulpo'}</Text></View>
        <Text style={[styles.emptyProvider, { color: theme.secondary }]}>{selectedModel?.provider.name ?? 'Choose a model to begin'}</Text>
        <View style={styles.suggestions}>{SUGGESTIONS.map((suggestion) => <Pressable key={suggestion} onPress={() => { setInput(suggestion); void submit(suggestion) }} style={[styles.suggestion, { backgroundColor: theme.fill, borderColor: theme.separator }]}><Text style={[styles.suggestionText, { color: theme.text }]}>{suggestion}</Text></Pressable>)}</View>
      </View> : null}
      renderItem={({ item }) => <MessageItem message={item} model={models.find((model) => model.id === item.modelId)} onReply={(text) => setInput(`> ${text.split('\n')[0]}\n\n`)} onEdit={edit} onRegenerate={regenerate} onDelete={remove} onActivateBranch={activate} onOpenAttachment={openAttachment} onContinueWithoutAgent={(message) => { void continueWithoutAgent(message.responseId).then(() => invalidate()) }} />}
      ListFooterComponent={pendingText ? <View style={{ gap: 18 }}><View style={[styles.pendingUser, { backgroundColor: theme.elevated }]}><Text style={{ color: theme.text, fontSize: 16 }}>{pendingText}</Text></View><View style={styles.pendingAssistant}><Image source={require('../../../assets/pulpo-smiley.png')} style={styles.pendingLogo} /><Text style={{ color: theme.secondary }}>Working…</Text></View></View> : null}
    />
    <Composer value={input} onChange={setInput} model={selectedModel} presets={presetSelections} attachments={attachments} agentMode={agentMode} canUseAgent={Boolean(modelResult?.agentAvailable && selectedModel?.agentEnabled)} active={active} onToggleAgent={() => { const next = !agentMode; setAgentMode(next); void setPreference('agentMode', next) }} onPickAttachment={chooseAttachment} onRemoveAttachment={(id) => setAttachments((current) => current.filter((item) => item.localId !== id))} onRetryAttachment={(attachment) => activeChatId && void uploadOne(attachment, activeChatId)} onOpenModels={() => setModelPicker(true)} onOpenPreset={openPreset} onSend={() => { void submit() }} onStop={() => { void stop() }} />
    <ModelPicker visible={modelPicker} models={models} selectedId={selectedModel?.id ?? null} onClose={() => setModelPicker(false)} onSelect={selectModel} />
  </View>
}

const styles = StyleSheet.create({
  root: { flex: 1 }, header: { height: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 8 }, headerTitle: { flex: 1, alignItems: 'center' }, title: { fontSize: 16, fontWeight: '700', maxWidth: '100%' }, subtitle: { fontSize: 10, marginTop: 2 }, messages: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 16 }, emptyMessages: { flexGrow: 1 }, center: { padding: 16, alignItems: 'center' }, empty: { flex: 1, justifyContent: 'center', paddingBottom: 60 }, modelTitle: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12 }, emptyTitle: { fontSize: 24, fontWeight: '800', letterSpacing: -0.6 }, emptyProvider: { textAlign: 'center', marginTop: 7, fontSize: 13 }, suggestions: { marginTop: 30, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, suggestion: { width: '48%', minHeight: 76, borderWidth: StyleSheet.hairlineWidth, borderRadius: 17, padding: 13, justifyContent: 'center' }, suggestionText: { fontSize: 13, lineHeight: 18, fontWeight: '600' }, pendingUser: { alignSelf: 'flex-end', maxWidth: '88%', borderRadius: 20, borderBottomRightRadius: 7, padding: 12 }, pendingAssistant: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 20 }, pendingLogo: { width: 27, height: 27, borderRadius: 8 },
})
