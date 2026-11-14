import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import {
  Button as SwiftUIButton,
  Form as SwiftUIForm,
  HStack as SwiftUIHStack,
  Host as SwiftUIHost,
  Image as SwiftUIImage,
  ProgressView as SwiftUIProgressView,
  RNHostView as SwiftUIRNHostView,
  Section as SwiftUISection,
  Text as SwiftUIText,
  VStack as SwiftUIVStack,
} from '@expo/ui/swift-ui'
import { accessibilityHint, accessibilityLabel, buttonStyle, controlSize, disabled, font, foregroundStyle, frame, lineLimit, padding, refreshable, tint } from '@expo/ui/swift-ui/modifiers'
import { MaterialButton } from '../../platform/MaterialUI'
import { SymbolView } from '../../platform/SymbolView'
import { Card, ListRow, SectionTitle } from '../../mockup5/src/components/PrototypeUI'
import { useAppTheme } from '../../mockup5/src/theme'
import type { RootStackParamList } from '../../mockup5/src/navigation'
import { usagePrivateNotice } from '../usage/format'
import { NativeNotice, NativePersonUsage } from '../usage/NativeUsage'
import { NativeLinkRow } from './NativeLinkRow'
import { PersonUsage, UsageNotice, UsagePage } from '../usage/UsageCards'
import { FriendAvatar, MaterialPersonRow, NativeCountHeader, NativePersonRow } from './FriendRows'
import { useFriendProfile, type FriendProfileAction, type FriendProfileModel, type ProfileUsageVisibility } from './useFriendProfile'

const NO_MUTUAL_FRIENDS = 'No mutual friends yet.'
const VISIBILITY_HINT = 'Changes who can see your usage'

interface ProfileNavigation {
  editProfile: () => void
  openLimits: () => void
  openLeaderboard: () => void
  openProfile: (username: string) => void
  back: () => void
}

/**
 * Anyone's profile: who they are, how they relate to the viewer, the usage they share, and the
 * friends in common. Your own shows all of your usage and leads to Edit Profile.
 */
export function FriendProfileScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'FriendProfile'>) {
  const model = useFriendProfile(route.params.username)
  const nav: ProfileNavigation = {
    editProfile: () => navigation.navigate('EditProfile'),
    openLimits: () => navigation.navigate('SettingsDetail', { section: 'usage' }),
    openLeaderboard: () => navigation.navigate('Leaderboard'),
    openProfile: (username) => navigation.push('FriendProfile', { username }),
    back: () => navigation.goBack(),
  }
  if (Platform.OS === 'ios') return <NativeFriendProfile model={model} nav={nav} />
  return <MaterialFriendProfile model={model} nav={nav} />
}

// iOS: a SwiftUI form, like Friends and Settings.

function NativeProfileAction({ action }: { action: FriendProfileAction }) {
  const theme = useAppTheme()
  if (action.kind === 'friends') return <SwiftUIHStack spacing={5}>
    <SwiftUIImage systemName="checkmark" size={13} color={theme.green} />
    <SwiftUIText modifiers={[font({ textStyle: 'subheadline', weight: 'medium' }), foregroundStyle(theme.green)]}>{action.label}</SwiftUIText>
  </SwiftUIHStack>
  return <SwiftUIButton
    label={action.pending ? action.pendingLabel : action.label}
    onPress={action.onPress}
    modifiers={[buttonStyle(action.kind === 'cancel' ? 'bordered' : 'borderedProminent'), controlSize('regular'), disabled(action.pending)]}
  />
}

/** Who can see this profile's usage. On your own profile it opens the setting that decides it. */
function NativeVisibility({ visibility, onChange }: { visibility: ProfileUsageVisibility; onChange?: () => void }) {
  const theme = useAppTheme()
  const line = <SwiftUIHStack spacing={5}>
    <SwiftUIImage systemName={visibility.icon as never} size={12} color={theme.secondary} />
    <SwiftUIText modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary')]}>{visibility.label}</SwiftUIText>
    {onChange ? <SwiftUIImage systemName="chevron.right" size={9} color={theme.tertiary} /> : null}
  </SwiftUIHStack>
  if (!onChange) return line
  return <SwiftUIButton onPress={onChange} modifiers={[buttonStyle('plain'), accessibilityLabel(visibility.label), accessibilityHint(VISIBILITY_HINT)]}>{line}</SwiftUIButton>
}

function NativeFriendProfile({ model, nav }: { model: FriendProfileModel; nav: ProfileNavigation }) {
  const theme = useAppTheme()
  const { query, identity, self, action, mutualFriends } = model
  const footnote = [font({ textStyle: 'footnote' }), foregroundStyle('secondary')]
  return <SwiftUIHost modifiers={[tint(theme.blue)]} style={styles.flex}><SwiftUIForm modifiers={[refreshable(async () => { await model.refresh() })]}>
    {query.isLoading ? <SwiftUISection><SwiftUIHStack spacing={10}><SwiftUIProgressView /><SwiftUIText modifiers={[foregroundStyle('secondary')]}>Loading profile…</SwiftUIText></SwiftUIHStack></SwiftUISection> : null}
    {query.error ? <SwiftUISection footer={<SwiftUIText modifiers={[foregroundStyle('secondary')]}>{query.error.message}</SwiftUIText>}><SwiftUIButton label="Try Again" systemImage="arrow.clockwise" onPress={() => void query.refetch()} /></SwiftUISection> : null}
    {identity ? <>
      <SwiftUISection>
        <SwiftUIVStack spacing={6} modifiers={[frame({ maxWidth: Infinity }), padding({ vertical: 12 })]}>
          <SwiftUIRNHostView matchContents><FriendAvatar profile={identity} size={88} /></SwiftUIRNHostView>
          <SwiftUIText modifiers={[font({ textStyle: 'title2', weight: 'semibold' }), lineLimit(2), padding({ top: 6 })]}>{identity.displayName}</SwiftUIText>
          <SwiftUIText modifiers={[foregroundStyle('secondary'), lineLimit(1)]}>{`@${identity.username}`}</SwiftUIText>
          {model.visibility ? <SwiftUIVStack modifiers={[padding({ top: 4 })]}><NativeVisibility visibility={model.visibility} onChange={self ? nav.editProfile : undefined} /></SwiftUIVStack> : null}
          {model.email ? <SwiftUIText modifiers={[...footnote, lineLimit(1)]}>{model.email}</SwiftUIText> : null}
          {model.joined ? <SwiftUIText modifiers={footnote}>{model.joined}</SwiftUIText> : null}
          {model.friendsSince ? <SwiftUIText modifiers={footnote}>{model.friendsSince}</SwiftUIText> : null}
          {self ? <SwiftUIVStack modifiers={[padding({ top: 8 })]}><SwiftUIButton label="Edit Profile" systemImage="pencil" onPress={nav.editProfile} modifiers={[buttonStyle('bordered'), controlSize('regular')]} /></SwiftUIVStack> : null}
          {action ? <SwiftUIVStack modifiers={[padding({ top: 8 })]}><NativeProfileAction action={action} /></SwiftUIVStack> : null}
        </SwiftUIVStack>
      </SwiftUISection>

      {self || model.canCompare ? <SwiftUISection>
        {model.showLimits ? <NativeLinkRow icon="gauge.with.dots.needle.33percent" title="Plan and Usage Limits" onPress={nav.openLimits} /> : null}
        <NativeLinkRow icon="chart.bar.fill" title="Compare with Friends" onPress={nav.openLeaderboard} />
      </SwiftUISection> : null}

      {model.usageShown ? <NativePersonUsage usage={model.usage} /> : null}
      {model.usagePrivate ? <SwiftUISection title="Usage"><NativeNotice icon="lock">{usagePrivateNotice(identity.displayName)}</NativeNotice></SwiftUISection> : null}

      {mutualFriends ? <SwiftUISection header={<NativeCountHeader title="Mutual friends" count={mutualFriends.length} />}>
        {mutualFriends.length
          ? mutualFriends.map((friend) => <NativePersonRow key={friend.id} profile={friend} onOpen={() => nav.openProfile(friend.username)} />)
          : <SwiftUIText modifiers={[foregroundStyle('secondary')]}>{NO_MUTUAL_FRIENDS}</SwiftUIText>}
      </SwiftUISection> : null}
    </> : null}
  </SwiftUIForm></SwiftUIHost>
}

// Android: Material cards and rows, like Friends there.

function MaterialProfileAction({ action }: { action: FriendProfileAction }) {
  const theme = useAppTheme()
  if (action.kind === 'friends') return <View style={styles.status}>
    <SymbolView name="checkmark" size={14} tintColor={theme.green} />
    <Text style={[styles.statusText, { color: theme.green }]}>{action.label}</Text>
  </View>
  return <MaterialButton
    compact
    label={action.label}
    icon={action.kind === 'add' ? 'person.badge.plus' : action.kind === 'accept' ? 'checkmark' : 'xmark'}
    variant={action.kind === 'cancel' ? 'secondary' : 'primary'}
    loading={action.pending}
    onPress={action.onPress}
  />
}

/** Who can see this profile's usage. On your own profile it opens the setting that decides it. */
function MaterialVisibility({ visibility, onChange }: { visibility: ProfileUsageVisibility; onChange?: () => void }) {
  const theme = useAppTheme()
  const line = <>
    <SymbolView name={visibility.icon as never} size={13} tintColor={theme.secondary} />
    <Text style={[styles.meta, { color: theme.secondary }]}>{visibility.label}</Text>
    {onChange ? <SymbolView name="chevron.right" size={10} tintColor={theme.tertiary} weight="semibold" /> : null}
  </>
  if (!onChange) return <View accessible accessibilityLabel={visibility.label} style={styles.metaLine}>{line}</View>
  return <Pressable accessibilityRole="button" accessibilityLabel={visibility.label} accessibilityHint={VISIBILITY_HINT} hitSlop={8} onPress={onChange} style={({ pressed }) => [styles.metaLine, pressed && styles.pressed]}>{line}</Pressable>
}

function MaterialFriendProfile({ model, nav }: { model: FriendProfileModel; nav: ProfileNavigation }) {
  const theme = useAppTheme()
  const { query, identity, self, action, mutualFriends } = model
  return <UsagePage title="Profile" onBack={nav.back} onRefresh={model.refresh}>
    {query.isLoading ? <Text style={[styles.message, { color: theme.secondary }]}>Loading profile…</Text> : null}
    {query.error ? <Card><ListRow icon="arrow.clockwise" iconColor={theme.blue} title="Profile could not be loaded" detail={`${query.error.message} Tap to retry.`} last onPress={() => void query.refetch()} /></Card> : null}
    {identity ? <>
      <Card style={styles.identity}>
        <FriendAvatar profile={identity} size={88} />
        <Text accessibilityRole="header" style={[styles.name, { color: theme.text }]} numberOfLines={2}>{identity.displayName}</Text>
        <Text style={[styles.handle, { color: theme.secondary }]} numberOfLines={1}>{`@${identity.username}`}</Text>
        <View style={styles.metas}>
          {model.visibility ? <MaterialVisibility visibility={model.visibility} onChange={self ? nav.editProfile : undefined} /> : null}
          {model.email ? <Text style={[styles.meta, { color: theme.secondary }]} numberOfLines={1}>{model.email}</Text> : null}
          {model.joined ? <Text style={[styles.meta, { color: theme.secondary }]}>{model.joined}</Text> : null}
          {model.friendsSince ? <Text style={[styles.meta, { color: theme.secondary }]}>{model.friendsSince}</Text> : null}
        </View>
        {self ? <View style={styles.action}><MaterialButton compact label="Edit Profile" icon="pencil" variant="secondary" onPress={nav.editProfile} /></View> : null}
        {action ? <View style={styles.action}><MaterialProfileAction action={action} /></View> : null}
      </Card>

      {self || model.canCompare ? <Card style={styles.links}>
        {model.showLimits ? <ListRow icon="gauge.with.dots.needle.33percent" title="Plan and Usage Limits" onPress={nav.openLimits} /> : null}
        <ListRow icon="chart.bar.fill" title="Compare with Friends" last onPress={nav.openLeaderboard} />
      </Card> : null}

      {model.usageShown || model.usagePrivate ? <SectionTitle>Usage</SectionTitle> : null}
      {model.usageShown ? <PersonUsage usage={model.usage} /> : null}
      {model.usagePrivate ? <Card><UsageNotice icon="lock">{usagePrivateNotice(identity.displayName)}</UsageNotice></Card> : null}

      {mutualFriends ? <>
        <SectionTitle trailing={<Text style={[styles.meta, { color: theme.secondary }]}>{mutualFriends.length}</Text>}>Mutual friends</SectionTitle>
        {mutualFriends.length
          ? <Card>{mutualFriends.map((friend, index) => <MaterialPersonRow key={friend.id} profile={friend} last={index === mutualFriends.length - 1} onOpen={() => nav.openProfile(friend.username)} />)}</Card>
          : <Card><Text style={[styles.message, { color: theme.secondary }]}>{NO_MUTUAL_FRIENDS}</Text></Card>}
      </> : null}
    </> : null}
  </UsagePage>
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  identity: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 24 },
  name: { fontSize: 22, fontWeight: '600', marginTop: 14, textAlign: 'center' },
  handle: { fontSize: 15, marginTop: 2 },
  metas: { alignItems: 'center', gap: 4, marginTop: 10 },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  meta: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  pressed: { opacity: 0.6 },
  action: { marginTop: 16 },
  links: { marginTop: 14 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { fontSize: 15, fontWeight: '500' },
  message: { fontSize: 14, lineHeight: 20, padding: 15, textAlign: 'center' },
})
