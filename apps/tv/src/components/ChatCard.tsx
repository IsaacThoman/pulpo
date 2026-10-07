import { Text, View } from 'react-native'
import { timeAgo } from '@/features/chat/format'
import type { ServerChat } from '@/types'
import { splitTitle } from '../chat/title'
import { CARD, useTVTheme, type } from '../theme'
import { Focusable } from './Focusable'
import { Icon } from './Icon'


export function ChatCard({ chat, onPress, onLongPress }: { chat: ServerChat; onPress: () => void; onLongPress: () => void }) {
  const theme = useTVTheme()
  const { emoji, text } = splitTitle(chat.title)
  return <Focusable testID="chat-card" onPress={onPress} onLongPress={onLongPress} accessibilityLabel={chat.title}
    style={{ width: CARD.width, height: CARD.height, borderRadius: 28, padding: 30, justifyContent: 'space-between' }}>
    {(focused) => <>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Text style={{ fontSize: 56 }}>{emoji ?? '💬'}</Text>
        {chat.pinned ? <Icon name="pin.fill" size={26} color={focused ? theme.focusText : theme.secondary} /> : null}
      </View>
      <View style={{ gap: 6 }}>
        <Text numberOfLines={2} style={{ fontSize: type.label, lineHeight: type.label * 1.25, fontWeight: '600', color: focused ? theme.focusText : theme.text }}>{text}</Text>
        <Text style={{ fontSize: type.caption - 2, color: focused ? theme.tertiary : theme.secondary }}>{timeAgo(Date.parse(chat.updatedAt))}</Text>
      </View>
    </>}
  </Focusable>
}
