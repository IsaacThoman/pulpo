import { useMemo, useState } from 'react'
import { FlatList, View } from 'react-native'
import { Field } from '../components/Field'
import { sortChats, useChats } from '../data'
import { useNavigation } from '../navigation'
import { CARD, SAFE } from '../theme'
import { ChatCard } from '../components/ChatCard'
import { useChatActions } from '../hooks'

const COLUMNS = 4

export function Library({ namespace }: { namespace: string }) {
  const push = useNavigation((state) => state.push)
  const chats = useChats(namespace)
  const chatActions = useChatActions(namespace)
  const [query, setQuery] = useState('')
  const rows = useMemo(() => {
    const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
    return sortChats(chats.data ?? []).filter((chat) => {
      const title = chat.title.toLocaleLowerCase()
      return words.every((word) => title.includes(word))
    })
  }, [chats.data, query])

  return <View style={{ flex: 1, paddingTop: SAFE.vertical }}>
    <View style={{ paddingHorizontal: 260, paddingBottom: 20 }}>
      <Field testID="search-field" icon="magnifyingglass" value={query} onChangeText={setQuery} placeholder="Search" autoCorrect={false} hasTVPreferredFocus />
    </View>
    <FlatList
      data={rows}
      numColumns={COLUMNS}
      keyExtractor={(chat) => chat.id}
      contentContainerStyle={{ paddingHorizontal: SAFE.horizontal, paddingVertical: 40, gap: 48 }}
      columnWrapperStyle={{ gap: (1920 - SAFE.horizontal * 2 - CARD.width * COLUMNS) / (COLUMNS - 1) }}
      renderItem={({ item }) => <ChatCard chat={item} onPress={() => push({ name: 'chat', chatId: item.id })} onLongPress={() => chatActions(item)} />}
    />
  </View>
}
