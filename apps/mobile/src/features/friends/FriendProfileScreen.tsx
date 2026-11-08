import { Platform, StyleSheet, Text, View } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { FriendProfile } from '@pulpo/contracts'
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
import { buttonStyle, controlSize, disabled, font, foregroundStyle, frame, lineLimit, padding, tint } from '@expo/ui/swift-ui/modifiers'
import { MaterialButton } from '../../platform/MaterialUI'
import { SymbolView } from '../../platform/SymbolView'
import { Card, ListRow, PageHeader, Screen, SectionTitle } from '../../mockup5/src/components/PrototypeUI'
import { useAppTheme } from '../../mockup5/src/theme'
import type { RootStackParamList } from '../../mockup5/src/navigation'
import { FriendAvatar, MaterialPersonRow, NativeCountHeader, NativePersonRow } from './FriendRows'
import { useFriendProfile, type FriendProfileAction, type FriendProfileModel } from './useFriendProfile'

const NO_MUTUAL_FRIENDS = 'No mutual friends yet.'

/** Anyone's profile: who they are, how they relate to the viewer, and the friends they share. */
export function FriendProfileScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'FriendProfile'>) {
  const model = useFriendProfile(route.params.username)
  const openProfile = (profile: FriendProfile) => navigation.push('FriendProfile', { username: profile.username })
  if (Platform.OS === 'ios') return <NativeFriendProfile model={model} onOpenProfile={openProfile} />
  return <MaterialFriendProfile model={model} onOpenProfile={openProfile} onBack={() => navigation.goBack()} />
}

// iOS: a SwiftUI form, like Friends.

function NativeProfileAction({ action }: { action: FriendProfileAction }) {
  const theme = useAppTheme()
  if (action.kind === 'friends') return <SwiftUIHStack spacing={5}>
    <SwiftUIImage systemName="checkmark" size={13} color={theme.green} />
    <SwiftUIText modifiers={[font({ textStyle: 'subheadline', weight: 'medium' }), foregroundStyle(theme.green)]}>{action.label}</SwiftUIText>
  </SwiftUIHStack>
  if (action.kind === 'self') return <SwiftUIText modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle('secondary')]}>{action.label}</SwiftUIText>
  return <SwiftUIButton
    label={action.pending ? action.pendingLabel : action.label}
    systemImage={action.kind === 'add' ? 'person.badge.plus' : action.kind === 'accept' ? 'checkmark' : 'xmark'}
    onPress={action.onPress}
    modifiers={[buttonStyle(action.kind === 'cancel' ? 'bordered' : 'borderedProminent'), controlSize('regular'), disabled(action.pending)]}
  />
}

function NativeFriendProfile({ model, onOpenProfile }: { model: FriendProfileModel; onOpenProfile: (profile: FriendProfile) => void }) {
  const theme = useAppTheme()
  const { query, detail, action, friendsSince, showMutualFriends } = model
  return <SwiftUIHost modifiers={[tint(theme.blue)]} style={styles.flex}><SwiftUIForm>
    {query.isLoading ? <SwiftUISection><SwiftUIHStack spacing={10}><SwiftUIProgressView /><SwiftUIText modifiers={[foregroundStyle('secondary')]}>Loading profile…</SwiftUIText></SwiftUIHStack></SwiftUISection> : null}
    {query.error ? <SwiftUISection footer={<SwiftUIText modifiers={[foregroundStyle('secondary')]}>{query.error.message}</SwiftUIText>}><SwiftUIButton label="Try Again" systemImage="arrow.clockwise" onPress={() => void query.refetch()} /></SwiftUISection> : null}
    {detail ? <SwiftUISection>
      <SwiftUIVStack spacing={6} modifiers={[frame({ maxWidth: Infinity }), padding({ vertical: 12 })]}>
        <SwiftUIRNHostView matchContents><FriendAvatar profile={detail.profile} size={88} /></SwiftUIRNHostView>
        <SwiftUIText modifiers={[font({ textStyle: 'title2', weight: 'semibold' }), lineLimit(2), padding({ top: 6 })]}>{detail.profile.displayName}</SwiftUIText>
        <SwiftUIText modifiers={[foregroundStyle('secondary'), lineLimit(1)]}>{`@${detail.profile.username}`}</SwiftUIText>
        {friendsSince ? <SwiftUIText modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary')]}>{friendsSince}</SwiftUIText> : null}
        {action ? <SwiftUIVStack modifiers={[padding({ top: 8 })]}><NativeProfileAction action={action} /></SwiftUIVStack> : null}
      </SwiftUIVStack>
    </SwiftUISection> : null}
    {detail && showMutualFriends ? <SwiftUISection header={<NativeCountHeader title="Mutual friends" count={detail.mutualFriends.length} />}>
      {detail.mutualFriends.length
        ? detail.mutualFriends.map((friend) => <NativePersonRow key={friend.id} profile={friend} onOpen={() => onOpenProfile(friend)} />)
        : <SwiftUIText modifiers={[foregroundStyle('secondary')]}>{NO_MUTUAL_FRIENDS}</SwiftUIText>}
    </SwiftUISection> : null}
  </SwiftUIForm></SwiftUIHost>
}

// Android: Material cards and rows, like Friends there.

function MaterialProfileAction({ action }: { action: FriendProfileAction }) {
  const theme = useAppTheme()
  if (action.kind === 'friends') return <View style={styles.status}>
    <SymbolView name="checkmark" size={14} tintColor={theme.green} />
    <Text style={[styles.statusText, { color: theme.green }]}>{action.label}</Text>
  </View>
  if (action.kind === 'self') return <Text style={[styles.statusText, { color: theme.secondary }]}>{action.label}</Text>
  return <MaterialButton
    compact
    label={action.label}
    icon={action.kind === 'add' ? 'person.badge.plus' : action.kind === 'accept' ? 'checkmark' : 'xmark'}
    variant={action.kind === 'cancel' ? 'secondary' : 'primary'}
    loading={action.pending}
    onPress={action.onPress}
  />
}

function MaterialFriendProfile({ model, onOpenProfile, onBack }: { model: FriendProfileModel; onOpenProfile: (profile: FriendProfile) => void; onBack: () => void }) {
  const theme = useAppTheme()
  const { query, detail, action, friendsSince, showMutualFriends } = model
  return <Screen>
    <PageHeader title="Profile" onBack={onBack} />
    {query.isLoading ? <Text style={[styles.message, { color: theme.secondary }]}>Loading profile…</Text> : null}
    {query.error ? <Card><ListRow icon="arrow.clockwise" iconColor={theme.blue} title="Profile could not be loaded" detail={`${query.error.message} Tap to retry.`} last onPress={() => void query.refetch()} /></Card> : null}
    {detail ? <Card style={styles.identity}>
      <FriendAvatar profile={detail.profile} size={88} />
      <Text style={[styles.name, { color: theme.text }]} numberOfLines={2}>{detail.profile.displayName}</Text>
      <Text style={[styles.handle, { color: theme.secondary }]} numberOfLines={1}>{`@${detail.profile.username}`}</Text>
      {friendsSince ? <Text style={[styles.since, { color: theme.secondary }]}>{friendsSince}</Text> : null}
      {action ? <View style={styles.action}><MaterialProfileAction action={action} /></View> : null}
    </Card> : null}
    {detail && showMutualFriends ? <>
      <SectionTitle trailing={<Text style={[styles.since, { color: theme.secondary }]}>{detail.mutualFriends.length}</Text>}>Mutual friends</SectionTitle>
      {detail.mutualFriends.length
        ? <Card>{detail.mutualFriends.map((friend, index) => <MaterialPersonRow key={friend.id} profile={friend} last={index === detail.mutualFriends.length - 1} onOpen={() => onOpenProfile(friend)} />)}</Card>
        : <Card><Text style={[styles.message, { color: theme.secondary }]}>{NO_MUTUAL_FRIENDS}</Text></Card>}
    </> : null}
  </Screen>
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  identity: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 24 },
  name: { fontSize: 22, fontWeight: '600', marginTop: 14, textAlign: 'center' },
  handle: { fontSize: 15, marginTop: 2 },
  since: { fontSize: 12, lineHeight: 18, marginTop: 8 },
  action: { marginTop: 16 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusText: { fontSize: 15, fontWeight: '500' },
  message: { fontSize: 14, lineHeight: 20, padding: 15, textAlign: 'center' },
})
