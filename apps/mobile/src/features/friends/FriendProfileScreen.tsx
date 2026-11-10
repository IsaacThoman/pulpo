import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { SymbolView } from '../../platform/SymbolView'
import { Card, ListRow, PrimaryButton, SectionTitle } from '../../mockup5/src/components/PrototypeUI'
import { useAppTheme } from '../../mockup5/src/theme'
import type { RootStackParamList } from '../../mockup5/src/navigation'
import { usagePrivateNotice } from '../usage/format'
import { PersonUsage, UsageNotice, UsagePage } from '../usage/UsageCards'
import { FriendAvatar, MaterialPersonRow } from './FriendRows'
import { useFriendProfile, type FriendProfileAction, type ProfileUsageVisibility } from './useFriendProfile'

const NO_MUTUAL_FRIENDS = 'No mutual friends yet.'

function ProfileAction({ action }: { action: FriendProfileAction }) {
  const theme = useAppTheme()
  if (action.kind === 'friends') return <View style={styles.status}>
    <SymbolView name="checkmark" size={14} tintColor={theme.green} />
    <Text style={[styles.statusText, { color: theme.green }]}>{action.label}</Text>
  </View>
  return <PrimaryButton
    label={action.label}
    icon={action.kind === 'add' ? 'person.badge.plus' : action.kind === 'accept' ? 'checkmark' : 'xmark'}
    variant={action.kind === 'cancel' ? 'secondary' : 'primary'}
    loading={action.pending}
    onPress={action.onPress}
  />
}

/** Who can see this profile's usage. On your own profile it opens the setting that decides it. */
function VisibilityLine({ visibility, onChange }: { visibility: ProfileUsageVisibility; onChange?: () => void }) {
  const theme = useAppTheme()
  const line = <>
    <SymbolView name={visibility.icon as never} size={13} tintColor={theme.secondary} />
    <Text style={[styles.meta, { color: theme.secondary }]}>{visibility.label}</Text>
    {onChange ? <SymbolView name="chevron.right" size={10} tintColor={theme.tertiary} weight="semibold" /> : null}
  </>
  if (!onChange) return <View accessible accessibilityLabel={visibility.label} style={styles.metaLine}>{line}</View>
  return <Pressable accessibilityRole="button" accessibilityLabel={visibility.label} accessibilityHint="Changes who can see your usage" hitSlop={8} onPress={onChange} style={({ pressed }) => [styles.metaLine, pressed && styles.pressed]}>{line}</Pressable>
}

/**
 * Anyone's profile: who they are, how they relate to the viewer, the usage they share, and the
 * friends in common. Your own shows all of your usage and leads to Edit Profile.
 */
export function FriendProfileScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'FriendProfile'>) {
  const theme = useAppTheme()
  const model = useFriendProfile(route.params.username)
  const { query, identity, self, action, mutualFriends } = model
  const editProfile = () => navigation.navigate('EditProfile')

  return <UsagePage title="Profile" onBack={() => navigation.goBack()} onRefresh={model.refresh}>
    {query.isLoading ? <Text style={[styles.message, { color: theme.secondary }]}>Loading profile…</Text> : null}
    {query.error ? <Card><ListRow icon="arrow.clockwise" iconColor={theme.blue} title="Profile could not be loaded" detail={`${query.error.message} Tap to retry.`} last onPress={() => void query.refetch()} /></Card> : null}
    {identity ? <>
      <Card style={styles.identity}>
        <FriendAvatar profile={identity} size={88} />
        <Text accessibilityRole="header" style={[styles.name, { color: theme.text }]} numberOfLines={2}>{identity.displayName}</Text>
        <Text style={[styles.handle, { color: theme.secondary }]} numberOfLines={1}>{`@${identity.username}`}</Text>
        <View style={styles.metas}>
          {model.visibility ? <VisibilityLine visibility={model.visibility} onChange={self ? editProfile : undefined} /> : null}
          {model.email ? <Text style={[styles.meta, { color: theme.secondary }]} numberOfLines={1}>{model.email}</Text> : null}
          {model.joined ? <Text style={[styles.meta, { color: theme.secondary }]}>{model.joined}</Text> : null}
          {model.friendsSince ? <Text style={[styles.meta, { color: theme.secondary }]}>{model.friendsSince}</Text> : null}
        </View>
        {self ? <View style={styles.action}><PrimaryButton label="Edit Profile" icon="pencil" variant="secondary" onPress={editProfile} /></View> : null}
        {action ? <View style={styles.action}><ProfileAction action={action} /></View> : null}
      </Card>

      {self || model.canCompare ? <Card style={styles.links}>
        {model.showLimits ? <ListRow icon="gauge.with.dots.needle.33percent" title="Plan and Usage Limits" onPress={() => navigation.navigate('SettingsDetail', { section: 'usage' })} /> : null}
        <ListRow icon="chart.bar.fill" title="Compare with Friends" last onPress={() => navigation.navigate('Leaderboard')} />
      </Card> : null}

      {model.usageShown || model.usagePrivate ? <SectionTitle>Usage</SectionTitle> : null}
      {model.usageShown ? <PersonUsage usage={model.usage} /> : null}
      {model.usagePrivate ? <Card><UsageNotice icon="lock">{usagePrivateNotice(identity.displayName)}</UsageNotice></Card> : null}

      {mutualFriends ? <>
        <SectionTitle trailing={<Text style={[styles.meta, { color: theme.secondary }]}>{mutualFriends.length}</Text>}>Mutual friends</SectionTitle>
        {mutualFriends.length
          ? <Card>{mutualFriends.map((friend, index) => <MaterialPersonRow key={friend.id} profile={friend} last={index === mutualFriends.length - 1} onOpen={() => navigation.push('FriendProfile', { username: friend.username })} />)}</Card>
          : <Card><Text style={[styles.message, { color: theme.secondary }]}>{NO_MUTUAL_FRIENDS}</Text></Card>}
      </> : null}
    </> : null}
  </UsagePage>
}

const styles = StyleSheet.create({
  identity: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 24 },
  name: { fontSize: 22, fontWeight: '600', marginTop: 14, textAlign: 'center' },
  handle: { fontSize: 15, marginTop: 2 },
  metas: { alignItems: 'center', gap: 4, marginTop: 10 },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  meta: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  pressed: { opacity: 0.6 },
  action: { alignSelf: 'stretch', alignItems: 'center', marginTop: 18 },
  links: { marginTop: 14 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { fontSize: 15, fontWeight: '500' },
  message: { fontSize: 14, lineHeight: 20, padding: 15, textAlign: 'center' },
})
