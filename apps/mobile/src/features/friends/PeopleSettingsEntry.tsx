import { Platform } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { Section } from '@expo/ui/swift-ui'
import { Card, ListRow, SectionTitle } from '../../mockup5/src/components/PrototypeUI'
import { pendingSocialCountQuery } from './api'
import { useFriendsContext } from './hooks'
import { friendsEntryDetail } from './format'
import { NativeLinkRow } from './NativeLinkRow'

const LEADERBOARD_DETAIL = 'Compare usage with friends'

/**
 * People in the Settings root, where the web has its People tabs: your profile, Friends with what
 * is waiting on you, and the leaderboard. Inside the Settings form on iOS; a card of its own on
 * Android.
 */
export function PeopleSettingsEntry({ onOpenProfile, onOpenFriends, onOpenLeaderboard }: {
  onOpenProfile: (username: string) => void
  onOpenFriends: () => void
  onOpenLeaderboard: () => void
}) {
  const { namespace, user, poolsEnabled } = useFriendsContext()
  const pending = useQuery({ ...pendingSocialCountQuery(namespace, poolsEnabled), enabled: Boolean(namespace) })
  const count = pending.data ?? 0
  const friendsDetail = friendsEntryDetail(count, poolsEnabled)
  const badge = count > 99 ? '99+' : count > 0 ? `${count}` : undefined
  const username = user?.username

  if (Platform.OS === 'ios') return <Section title="People">
    {username ? <NativeLinkRow icon="person.crop.circle" title="Profile" detail={`@${username}`} onPress={() => onOpenProfile(username)} /> : null}
    <NativeLinkRow icon="person.2" title="Friends" detail={friendsDetail} badge={badge} onPress={onOpenFriends} />
    <NativeLinkRow icon="chart.bar.fill" title="Leaderboard" detail={LEADERBOARD_DETAIL} onPress={onOpenLeaderboard} />
  </Section>

  return <>
    <SectionTitle>People</SectionTitle>
    <Card>
      {username ? <ListRow icon="person.crop.circle" title="Profile" detail={`@${username}`} onPress={() => onOpenProfile(username)} /> : null}
      <ListRow icon="person.2" title="Friends" detail={friendsDetail} value={badge} onPress={onOpenFriends} />
      <ListRow icon="chart.bar.fill" title="Leaderboard" detail={LEADERBOARD_DETAIL} last onPress={onOpenLeaderboard} />
    </Card>
  </>
}
