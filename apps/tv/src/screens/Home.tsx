import { useState } from 'react'
import { FlatList, Text, View } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { failureMessage, useTurnFailures } from '../chat/failures'
import { ChatCard } from '../components/ChatCard'
import { Field } from '../components/Field'
import { IconButton } from '../components/IconButton'
import { ModelChip } from '../components/ModelChip'
import { Smiley } from '../components/Smiley'
import { sendTurn, setDefaultModel, sortChats, useChats, useModels } from '../data'
import { useChatActions, useModelPicker } from '../hooks'
import { useNavigation } from '../navigation'
import { CARD, SAFE, useTVTheme, type } from '../theme'

export function Home({ namespace }: { namespace: string }) {
  const theme = useTVTheme()
  const queryClient = useQueryClient()
  const push = useNavigation((state) => state.push)
  const chats = useChats(namespace)
  const { defaultModel: model } = useModels(namespace)
  const [draft, setDraft] = useState('')
  const pickModel = useModelPicker()
  const chatActions = useChatActions(namespace)
  const rows = sortChats(chats.data ?? [])

  const ask = () => {
    const text = draft.trim()
    if (!text || !model) return
    const { chatId, done } = sendTurn({ queryClient, namespace, chatId: null, text, modelId: model.id, parentResponseId: null })
    setDraft('')
    push({ name: 'chat', chatId })
    done.catch((error: unknown) => useTurnFailures.getState().fail(chatId, { text, message: failureMessage(error) }))
  }

  return <View style={{ flex: 1, paddingTop: SAFE.vertical }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SAFE.horizontal }}>
      <Smiley size={84} />
      <View style={{ flexDirection: 'row', gap: 24, alignItems: 'center' }}>
        <IconButton testID="search" icon="magnifyingglass" accessibilityLabel="Search" onPress={() => push({ name: 'library' })} />
        <ModelChip testID="model" model={model} onPress={() => pickModel(model, (modelId) => { void setDefaultModel(queryClient, namespace, modelId).catch(() => undefined) })} />
        <IconButton testID="settings" icon="gearshape" accessibilityLabel="Settings" onPress={() => push({ name: 'settings' })} />
      </View>
    </View>
    <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 260 }}>
      <Field testID="ask" icon="sparkles" value={draft} onChangeText={setDraft} placeholder="Ask anything" height={120}
        returnKeyType="send" onSubmitEditing={ask} hasTVPreferredFocus fontSize={38} />
    </View>
    <View style={{ height: CARD.height + 120, opacity: rows.length ? 1 : 0 }}>
      <FlatList
        horizontal
        data={rows.slice(0, 30)}
        keyExtractor={(chat) => chat.id}
        contentContainerStyle={{ paddingHorizontal: SAFE.horizontal, paddingVertical: 40, gap: 40 }}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item }) => <ChatCard chat={item} onPress={() => push({ name: 'chat', chatId: item.id })} onLongPress={() => chatActions(item)} />}
      />
    </View>
    {chats.isError && !rows.length ? <Text style={{ position: 'absolute', bottom: SAFE.vertical, alignSelf: 'center', fontSize: type.caption, color: theme.secondary }}>Offline</Text> : null}
  </View>
}
