import { Platform } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { Button, HStack, Image, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui'
import { background, buttonStyle, contentShape, font, foregroundStyle, frame, lineLimit, padding, shapes } from '@expo/ui/swift-ui/modifiers'
import { Card, ListRow, SectionTitle } from '../../mockup5/src/components/PrototypeUI'
import { useAppTheme } from '../../mockup5/src/theme'
import { pendingSocialCountQuery } from './api'
import { useFriendsContext } from './hooks'
import { friendsEntryDetail } from './format'

const LEADERBOARD_DETAIL = 'Compare usage with friends'

function NativeRow({ icon, title, detail, badge, onPress }: { icon: string; title: string; detail: string; badge?: string; onPress: () => void }) {
  const theme = useAppTheme()
  return <Button modifiers={[buttonStyle('plain'), foregroundStyle('primary')]} onPress={onPress}>
    <HStack spacing={12} modifiers={[contentShape(shapes.rectangle())]}>
      <Image systemName={icon as never} size={17} modifiers={[frame({ width: 22, height: 22 })]} />
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ textStyle: 'subheadline', weight: 'medium' }), lineLimit(2)]}>{title}</Text>
        <Text modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary'), lineLimit(3)]}>{detail}</Text>
      </VStack>
      <Spacer />
      {badge ? <Text modifiers={[font({ textStyle: 'footnote', weight: 'semibold' }), foregroundStyle('white'), padding({ horizontal: 7, vertical: 2 }), background(theme.red, shapes.capsule())]}>{badge}</Text> : null}
      <Image systemName="chevron.right" size={11} />
    </HStack>
  </Button>
}

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
    {username ? <NativeRow icon="person.crop.circle" title="Profile" detail={`@${username}`} onPress={() => onOpenProfile(username)} /> : null}
    <NativeRow icon="person.2" title="Friends" detail={friendsDetail} badge={badge} onPress={onOpenFriends} />
    <NativeRow icon="chart.bar.fill" title="Leaderboard" detail={LEADERBOARD_DETAIL} onPress={onOpenLeaderboard} />
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
