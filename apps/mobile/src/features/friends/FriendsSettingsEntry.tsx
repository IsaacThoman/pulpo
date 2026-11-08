import { Platform } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { Button, HStack, Image, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui'
import { background, buttonStyle, contentShape, font, foregroundStyle, frame, lineLimit, padding, shapes } from '@expo/ui/swift-ui/modifiers'
import { Card, ListRow, SectionTitle } from '../../mockup5/src/components/PrototypeUI'
import { useAppTheme } from '../../mockup5/src/theme'
import { pendingSocialCountQuery } from './api'
import { useFriendsContext } from './hooks'
import { friendsEntryDetail } from './format'

/**
 * The Friends entry in the Settings root, where the web keeps it in the account menu. Inside the
 * Settings form on iOS; a card of its own on Android.
 */
export function FriendsSettingsEntry({ onPress }: { onPress: () => void }) {
  const theme = useAppTheme()
  const { namespace, poolsEnabled } = useFriendsContext()
  const pending = useQuery({ ...pendingSocialCountQuery(namespace, poolsEnabled), enabled: Boolean(namespace) })
  const count = pending.data ?? 0
  const detail = friendsEntryDetail(count, poolsEnabled)
  const badge = count > 99 ? '99+' : `${count}`

  if (Platform.OS === 'ios') return <Section title="Social">
    <Button modifiers={[buttonStyle('plain'), foregroundStyle('primary')]} onPress={onPress}>
      <HStack spacing={12} modifiers={[contentShape(shapes.rectangle())]}>
        <Image systemName="person.2" size={17} modifiers={[frame({ width: 22, height: 22 })]} />
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ textStyle: 'subheadline', weight: 'medium' }), lineLimit(2)]}>Friends</Text>
          <Text modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary'), lineLimit(3)]}>{detail}</Text>
        </VStack>
        <Spacer />
        {count > 0 ? <Text modifiers={[font({ textStyle: 'footnote', weight: 'semibold' }), foregroundStyle('white'), padding({ horizontal: 7, vertical: 2 }), background(theme.red, shapes.capsule())]}>{badge}</Text> : null}
        <Image systemName="chevron.right" size={11} />
      </HStack>
    </Button>
  </Section>

  return <>
    <SectionTitle>Social</SectionTitle>
    <Card><ListRow icon="person.2" title="Friends" detail={detail} value={count > 0 ? badge : undefined} last onPress={onPress} /></Card>
  </>
}
