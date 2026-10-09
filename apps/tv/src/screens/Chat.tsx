import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Easing, ScrollView, Text, View } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import type { DisplayMessage } from '@/features/chat/projection'
import type { MobileModel } from '@/types'
import { failureMessage, useTurnFailures } from '../chat/failures'
import { MarkdownBlocks } from '../chat/Markdown'
import { pageBlocks, parseMarkdown } from '../chat/blocks'
import { splitTitle } from '../chat/title'
import { Field } from '../components/Field'
import { Focusable } from '../components/Focusable'
import { IconButton } from '../components/IconButton'
import { ModelChip } from '../components/ModelChip'
import { ModelIcon } from '../components/ModelIcon'
import { isActive, regenerate, sendTurn, setChatModel, showVersion, stopResponse, useConversation, useModels } from '../data'
import { useNavigation, type SheetAction } from '../navigation'
import { SAFE, useTVTheme, type, type TVTheme } from '../theme'
import { useModelPicker } from '../hooks'

const COLUMN = 1400

function ThinkingDots({ theme }: { theme: TVTheme }) {
  const progress = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(progress, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }))
    loop.start()
    return () => loop.stop()
  }, [progress])
  return <View accessibilityLabel="Thinking" style={{ flexDirection: 'row', gap: 14, paddingVertical: 20 }}>
    {[0, 1, 2].map((index) => <Animated.View key={index} style={{
      width: 18, height: 18, borderRadius: 9, backgroundColor: theme.secondary,
      opacity: progress.interpolate({
        inputRange: [0, 0.2 + index * 0.2, 0.4 + index * 0.2, 1],
        outputRange: [0.25, 1, 0.25, 0.25],
      }),
    }} />)}
  </View>
}

function UserMessage({ message, theme }: { message: DisplayMessage; theme: TVTheme }) {
  return <View style={{ alignItems: 'flex-end' }}>
    <Focusable testID="user-message" lift={1.02} style={{ maxWidth: COLUMN * 0.72, borderRadius: 32, paddingHorizontal: 36, paddingVertical: 24 }}
      focusedStyle={{ backgroundColor: theme.fillStrong, shadowOpacity: 0 }}>
      <Text style={{ fontSize: type.body, lineHeight: type.body * 1.4, color: theme.text }}>{message.text}</Text>
    </Focusable>
  </View>
}

const AssistantMessage = memo(function AssistantMessage({ message, model, theme, onSelect }: {
  message: DisplayMessage
  model: MobileModel | undefined
  theme: TVTheme
  onSelect: (message: DisplayMessage) => void
}) {
  const pages = useMemo(() => pageBlocks(parseMarkdown(message.text)), [message.text])
  const active = isActive(message.status)
  const versions = message.branch.ids.length
  return <View style={{ gap: 8 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 32 }}>
      <ModelIcon model={model} size={36} />
      {versions > 1 ? <Text style={{ fontSize: type.caption, color: theme.secondary }}>{message.branch.index + 1}/{versions}</Text> : null}
    </View>
    {pages.length ? pages.map((page, index) => (
      <Focusable key={index} testID="assistant-page" lift={1.01} onPress={() => onSelect(message)}
        style={{ backgroundColor: 'transparent', borderRadius: 28, paddingHorizontal: 32, paddingVertical: 20 }}
        focusedStyle={{ backgroundColor: theme.fill, shadowOpacity: 0 }}>
        <MarkdownBlocks blocks={page} theme={theme} />
      </Focusable>
    )) : active ? <View style={{ paddingHorizontal: 32 }}><ThinkingDots theme={theme} /></View> : null}
    {pages.length && active ? <View style={{ paddingHorizontal: 32 }}><ThinkingDots theme={theme} /></View> : null}
    {message.error ? <Focusable testID="assistant-error" onPress={() => onSelect(message)} lift={1.01}
      style={{ backgroundColor: 'transparent', paddingHorizontal: 32, paddingVertical: 16 }}
      focusedStyle={{ backgroundColor: theme.fill, shadowOpacity: 0 }}>
      <Text style={{ fontSize: type.label, color: theme.red }}>{message.error}</Text>
    </Focusable> : null}
  </View>
})

export function Chat({ namespace, chatId }: { namespace: string; chatId: string }) {
  const theme = useTVTheme()
  const queryClient = useQueryClient()
  const present = useNavigation((state) => state.present)
  const { chat, messages, loading } = useConversation(namespace, chatId)
  const { models, defaultModel } = useModels(namespace)
  const pickModel = useModelPicker()
  const failure = useTurnFailures((state) => state.failures[chatId])
  const [draft, setDraft] = useState('')
  const [inputFocused, setInputFocused] = useState(true)
  const scroll = useRef<ScrollView>(null)

  const model = models.find((item) => item.id === chat?.modelId) ?? defaultModel
  const modelsById = useMemo(() => new Map(models.map((item) => [item.id, item])), [models])
  const last = messages.at(-1)
  const streaming = last?.role === 'assistant' && isActive(last.status) ? last : undefined

  useEffect(() => {
    if (failure) setDraft((current) => current || failure.text)
  }, [failure])

  // Follow the newest text while the reply field has focus; reading earlier
  // pages moves focus up, which leaves the scroll position to the user.
  useEffect(() => {
    if (inputFocused) requestAnimationFrame(() => scroll.current?.scrollToEnd({ animated: true }))
  }, [inputFocused, last?.text, messages.length])

  // A reply submitted while the model is still answering waits its turn.
  const [queued, setQueued] = useState<string | null>(null)
  const send = (text: string) => {
    if (!model) return
    useTurnFailures.getState().clear(chatId)
    const parentResponseId = [...messages].reverse().find((message) => message.role === 'assistant')?.responseId ?? null
    const { done } = sendTurn({ queryClient, namespace, chatId, text, modelId: model.id, parentResponseId })
    done.catch((error: unknown) => useTurnFailures.getState().fail(chatId, { text, message: failureMessage(error) }))
  }
  const reply = () => {
    const text = draft.trim()
    if (!text) return
    setDraft('')
    if (streaming) setQueued(text)
    else send(text)
  }
  useEffect(() => {
    if (!queued || streaming) return
    setQueued(null)
    send(queued)
    // oxlint-disable-next-line react/exhaustive-deps -- send reads the latest transcript when the stream ends
  }, [queued, streaming])

  const selectMessage = (message: DisplayMessage) => {
    const actions: SheetAction[] = []
    if (isActive(message.status)) {
      actions.push({ key: 'stop', label: 'Stop', icon: 'stop.fill', run: () => { void stopResponse(queryClient, namespace, chatId, message.responseId).catch(() => undefined) } })
    } else if (model) {
      actions.push({ key: 'regenerate', label: 'Regenerate', icon: 'arrow.clockwise', run: () => { void regenerate(queryClient, namespace, chatId, message.responseId, model.id).catch((error: unknown) => useTurnFailures.getState().fail(chatId, { text: '', message: failureMessage(error) })) } })
    }
    const { ids, index } = message.branch
    if (index > 0) actions.push({ key: 'previous', label: 'Previous', icon: 'chevron.left', run: () => { void showVersion(queryClient, namespace, chatId, ids[index - 1]!).catch(() => undefined) } })
    if (index < ids.length - 1) actions.push({ key: 'next', label: 'Next', icon: 'chevron.right', run: () => { void showVersion(queryClient, namespace, chatId, ids[index + 1]!).catch(() => undefined) } })
    if (actions.length) present({ name: 'actions', actions })
  }

  const { emoji, text: title } = splitTitle(chat?.title ?? '')

  return <View style={{ flex: 1 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SAFE.horizontal, paddingTop: SAFE.vertical, paddingBottom: 16 }}>
      <Text testID="chat-title" accessibilityLabel={chat?.title ?? ''} numberOfLines={1} style={{ flex: 1, marginRight: 40, fontSize: type.label, fontWeight: '600', color: theme.secondary }}>
        {chat ? `${emoji ? `${emoji}  ` : ''}${title}` : ''}
      </Text>
      <ModelChip testID="model" model={model} onPress={() => pickModel(model, (modelId) => { void setChatModel(queryClient, namespace, chatId, modelId).catch(() => undefined) })} />
    </View>
    <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 40, alignItems: 'center' }}
      onContentSizeChange={() => { if (inputFocused) scroll.current?.scrollToEnd({ animated: false }) }}>
      <View style={{ width: COLUMN, gap: 48 }}>
        {loading ? <ThinkingDots theme={theme} /> : null}
        {messages.map((message) => message.role === 'user'
          ? <UserMessage key={message.id} message={message} theme={theme} />
          : <AssistantMessage key={message.id} message={message} model={modelsById.get(message.modelId)} theme={theme} onSelect={selectMessage} />)}
        {queued ? <View style={{ alignItems: 'flex-end', opacity: 0.5 }}>
          <View style={{ maxWidth: COLUMN * 0.72, borderRadius: 32, paddingHorizontal: 36, paddingVertical: 24, backgroundColor: theme.card }}>
            <Text style={{ fontSize: type.body, lineHeight: type.body * 1.4, color: theme.text }}>{queued}</Text>
          </View>
        </View> : null}
      </View>
    </ScrollView>
    <View style={{ paddingHorizontal: SAFE.horizontal, paddingBottom: SAFE.vertical, paddingTop: 20, alignItems: 'center' }}>
      {failure ? <Text style={{ fontSize: type.caption, color: theme.red, marginBottom: 16 }}>{failure.message}</Text> : null}
      <View style={{ width: COLUMN, flexDirection: 'row', alignItems: 'center', gap: 24 }}>
        <View style={{ flex: 1 }}>
          <Field testID="reply" icon="text.bubble" value={draft} onChangeText={setDraft} placeholder="Reply" returnKeyType="send"
            onSubmitEditing={reply} hasTVPreferredFocus
            onFocusChange={setInputFocused} />
        </View>
        {streaming ? <IconButton testID="stop" icon="stop.fill" accessibilityLabel="Stop"
          onPress={() => { void stopResponse(queryClient, namespace, chatId, streaming.responseId).catch(() => undefined) }} /> : null}
      </View>
    </View>
  </View>
}
