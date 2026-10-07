import { ScrollView, Text, View } from 'react-native'
import { useSessionStore } from '@/store/session'
import type { User } from '@/types'
import { Focusable } from '../components/Focusable'
import { Icon } from '../components/Icon'
import { IconButton } from '../components/IconButton'
import { useNavigation } from '../navigation'
import { SAFE, useTVTheme, type } from '../theme'

function initials(user: User): string {
  return (user.name || user.email).trim().slice(0, 1).toUpperCase()
}

function AccountRow({ user, current, onPress }: { user: User; current: boolean; onPress?: () => void }) {
  const theme = useTVTheme()
  return <Focusable onPress={onPress} lift={1.03} style={{ borderRadius: 32, paddingHorizontal: 32, paddingVertical: 24 }}>
    {(focused) => <View style={{ flexDirection: 'row', alignItems: 'center', gap: 28 }}>
      <View style={{ width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? theme.focusText : theme.fillStrong }}>
        <Text style={{ fontSize: 38, fontWeight: '700', color: focused ? theme.focus : theme.text }}>{initials(user)}</Text>
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text numberOfLines={1} style={{ fontSize: type.body, fontWeight: '600', color: focused ? theme.focusText : theme.text }}>{user.name || user.email}</Text>
        <Text numberOfLines={1} style={{ fontSize: type.caption, color: focused ? theme.tertiary : theme.secondary }}>{user.email}</Text>
      </View>
      {current ? <Icon name="checkmark" size={34} color={focused ? theme.focusText : theme.text} /> : null}
    </View>}
  </Focusable>
}

export function Settings() {
  const user = useSessionStore((state) => state.user)
  const accounts = useSessionStore((state) => state.accounts)
  const switchAccount = useSessionStore((state) => state.switchAccount)
  const addAccount = useSessionStore((state) => state.addAccount)
  const logout = useSessionStore((state) => state.logout)
  const reset = useNavigation((state) => state.reset)
  if (!user) return null
  const others = accounts.filter((account) => account.id !== user.id)

  return <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: SAFE.vertical + 40 }}>
    <View style={{ width: 900, gap: 28 }}>
      <AccountRow user={user} current />
      {others.map((account) => <AccountRow key={account.id} user={account} current={false}
        onPress={() => { reset(); void switchAccount(account.id) }} />)}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 24, marginTop: 32 }}>
        <IconButton testID="add-account" icon="person.crop.circle.badge.plus" label="Add account" onPress={() => { reset(); void addAccount() }} />
        <IconButton testID="sign-out" icon="rectangle.portrait.and.arrow.right" label="Sign out" onPress={() => { reset(); void logout() }} />
      </View>
    </View>
  </ScrollView>
}
