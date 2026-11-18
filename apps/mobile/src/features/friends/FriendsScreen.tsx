import { useEffect, useState, type ReactNode } from 'react'
import { Platform, Pressable, StyleSheet, Text } from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { FriendSearchResult } from '@pulpo/contracts'
import {
  Button as SwiftUIButton,
  DisclosureGroup as SwiftUIDisclosureGroup,
  Divider as SwiftUIDivider,
  Form as SwiftUIForm,
  HStack as SwiftUIHStack,
  Host as SwiftUIHost,
  Image as SwiftUIImage,
  Menu as SwiftUIMenu,
  ProgressView as SwiftUIProgressView,
  Section as SwiftUISection,
  Spacer as SwiftUISpacer,
  Text as SwiftUIText,
  TextField as SwiftUITextField,
  VStack as SwiftUIVStack,
  useNativeState,
} from '@expo/ui/swift-ui'
import {
  accessibilityLabel,
  autocorrectionDisabled,
  buttonStyle,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  frame,
  labelStyle,
  scrollDismissesKeyboard,
  textFieldStyle,
  textInputAutocapitalization,
  tint,
} from '@expo/ui/swift-ui/modifiers'
import { MaterialButton, MaterialIconButton, MaterialNavigationRow } from '../../platform/MaterialUI'
import { showActions } from '../../platform/materialActions'
import { SymbolView } from '../../platform/SymbolView'
import { Card, EmptyState, Field, ListRow, PageHeader, Screen, SectionTitle } from '../../mockup5/src/components/PrototypeUI'
import { useAppTheme } from '../../mockup5/src/theme'
import type { RootStackParamList } from '../../mockup5/src/navigation'
import { NativeUsageLimit, UsageLimitCard } from '../usage-limits/UsageLimitsSettings'
import { invitationMembersLabel, mutualFriendsLabel, poolMembersLabel, poolUsageRows } from './format'
import { NativeLinkRow } from './NativeLinkRow'
import { MaterialPersonRow, NativeCountHeader, NativePersonRow, NativeRowButton } from './FriendRows'
import { useFriendsScreen, type FriendMenuAction, type FriendsScreenModel } from './useFriendsScreen'

const EMPTY_TITLE = 'Add friends'
const EMPTY_DETAIL = 'Find someone by their name or Pulpo username.'
const ALL_IN_POOL = 'All your friends are in your Pool.'
const SEARCH_PLACEHOLDER = 'Name or username'
const POOL_SEATS_FOOTER = 'Pending invitations reserve a Pool seat.'
const TRANSFER_FIRST = 'Transfer ownership before leaving this Pool.'
const LEAVE_CURRENT_FIRST = 'Leave your current Pool before joining another.'
const LEADERBOARD_DETAIL = 'Compare usage with your friends.'

/** Adding and dismissing the same suggestion exclude each other. */
function suggestionBusy(pending: ReadonlySet<string>, profileId: string): boolean {
  return pending.has(`request:${profileId}`) || pending.has(`dismiss:${profileId}`)
}

function searchStatus(model: FriendsScreenModel): string | null {
  const { search, searchInput } = model
  if (search.state === 'loading') return 'Searching people…'
  if (search.state === 'error') return search.error
  if (search.state === 'success' && !search.results.length) return `No people found for “${searchInput.trim()}”`
  return null
}

/** Friends, friend requests, and the viewer's Pool, as on the web's Friends page. */
export function FriendsScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Friends'>) {
  const model = useFriendsScreen({
    openProfile: (profile) => navigation.push('FriendProfile', { username: profile.username }),
    openLeaderboard: () => navigation.navigate('Leaderboard'),
  })
  if (Platform.OS === 'ios') return <NativeFriends model={model} />
  return <MaterialFriends model={model} onBack={() => navigation.goBack()} />
}

// iOS: a SwiftUI form, like Settings.

function NativeMenu({ name, actions }: { name: string; actions: FriendMenuAction[] }) {
  if (!actions.length) return null
  return <SwiftUIMenu label="More" systemImage="ellipsis.circle" modifiers={[labelStyle('iconOnly'), buttonStyle('borderless'), foregroundStyle('secondary'), accessibilityLabel(`More options for ${name}`)]}>
    {actions.map((action) => [
      action.separated ? <SwiftUIDivider key={`${action.label}-divider`} /> : null,
      <SwiftUIButton key={action.label} label={action.label} systemImage={action.icon as never} role={action.destructive ? 'destructive' : 'default'} onPress={action.onPress} modifiers={action.disabled ? [disabled(true)] : []} />,
    ])}
  </SwiftUIMenu>
}

function NativeSearchField({ value, onChange, loading }: { value: string; onChange: (value: string) => void; loading: boolean }) {
  const theme = useAppTheme()
  const text = useNativeState(value)
  useEffect(() => { if (text.get() !== value) text.set(value) }, [text, value])
  return <SwiftUIHStack spacing={10}>
    <SwiftUIImage systemName="magnifyingglass" size={15} color={theme.secondary} />
    <SwiftUITextField text={text} placeholder={SEARCH_PLACEHOLDER} maxLength={120} onTextChange={onChange} modifiers={[textFieldStyle('plain'), textInputAutocapitalization('never'), autocorrectionDisabled(), accessibilityLabel('Search friends')]} />
    {loading ? <SwiftUIProgressView modifiers={[controlSize('small')]} /> : null}
  </SwiftUIHStack>
}

function NativeSearchResult({ model, result }: { model: FriendsScreenModel; result: FriendSearchResult }) {
  const theme = useAppTheme()
  const { pending, actions } = model
  const trailing = result.relationship === 'none'
    ? <NativeRowButton prominent label={pending.has(`request:${result.profile.id}`) ? 'Sending…' : 'Add'} isDisabled={pending.has(`request:${result.profile.id}`)} onPress={() => actions.sendRequest(result)} />
    : result.relationship === 'incoming'
      ? <NativeRowButton prominent label={pending.has(`accept:${result.requestId}`) ? 'Accepting…' : 'Accept'} isDisabled={pending.has(`accept:${result.requestId}`)} onPress={() => actions.acceptSearchResult(result)} />
      : result.relationship === 'friends'
        ? <SwiftUIHStack spacing={4}><SwiftUIImage systemName="checkmark" size={12} color={theme.green} /><SwiftUIText modifiers={[font({ textStyle: 'footnote' }), foregroundStyle(theme.green)]}>Friends</SwiftUIText></SwiftUIHStack>
        : <SwiftUIText modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary')]}>{result.relationship === 'outgoing' ? 'Request sent' : 'You'}</SwiftUIText>
  return <NativePersonRow profile={result.profile} trailing={trailing} onOpen={() => model.openProfile(result.profile)} />
}

function NativeFriends({ model }: { model: FriendsScreenModel }) {
  const theme = useAppTheme()
  const { user, list, pool, currentPool, poolInvitations, overview, inviteCodes, search, pending, busy, copied, actions } = model
  const [sentOpen, setSentOpen] = useState(false)
  const [blockedOpen, setBlockedOpen] = useState(false)
  const data = list.data
  const status = search.ready ? searchStatus(model) : null
  const viewerId = user?.id

  return <SwiftUIHost modifiers={[tint(theme.blue)]} style={styles.flex}><SwiftUIForm modifiers={[scrollDismissesKeyboard('interactively')]}>
    <SwiftUISection title="Find your friends" footer={<SwiftUIText modifiers={[foregroundStyle('secondary')]}>Friends can find you by your name or handle.</SwiftUIText>}>
      {user ? <SwiftUIButton onPress={actions.copyHandle} modifiers={[buttonStyle('plain'), accessibilityLabel(`Copy @${user.username}`)]}>
        <SwiftUIHStack spacing={12}>
          <SwiftUIText>Your handle</SwiftUIText>
          <SwiftUISpacer />
          <SwiftUIText modifiers={[foregroundStyle('secondary')]}>{`@${user.username}`}</SwiftUIText>
          <SwiftUIImage systemName={copied === 'handle' ? 'checkmark' : 'doc.on.doc'} size={13} color={copied === 'handle' ? theme.green : theme.secondary} />
        </SwiftUIHStack>
      </SwiftUIButton> : null}
      <NativeSearchField value={model.searchInput} onChange={model.setSearchInput} loading={search.state === 'loading'} />
      {status ? <SwiftUIText modifiers={[foregroundStyle('secondary'), font({ textStyle: 'footnote' })]}>{status}</SwiftUIText> : null}
      {search.ready ? search.results.map((result) => <NativeSearchResult key={result.profile.id} model={model} result={result} />) : null}
    </SwiftUISection>

    {inviteCodes ? <SwiftUISection title="Invite codes" footer={<SwiftUIText modifiers={[foregroundStyle('secondary')]}>{`${model.inviteCodesRemaining} of ${inviteCodes.quota} remaining`}</SwiftUIText>}>
      {inviteCodes.codes.map((code) => <SwiftUIHStack key={code.id} spacing={12}>
        <SwiftUIText modifiers={[font({ design: 'monospaced' })]}>{code.code}</SwiftUIText>
        <SwiftUISpacer />
        <SwiftUIButton label={copied === code.id ? 'Copied' : 'Copy'} systemImage={copied === code.id ? 'checkmark' : 'doc.on.doc'} onPress={() => actions.copyInviteCode(code.id, code.code)} modifiers={[labelStyle('iconOnly'), buttonStyle('borderless'), accessibilityLabel(`Copy ${code.code}`)]} />
        <SwiftUIButton label="Revoke" systemImage="trash" role="destructive" onPress={() => actions.revokeInviteCode(code.id)} modifiers={[labelStyle('iconOnly'), buttonStyle('borderless'), disabled(busy), accessibilityLabel(`Revoke ${code.code}`)]} />
      </SwiftUIHStack>)}
      <SwiftUIButton label="Generate Invite Code" systemImage="plus" onPress={actions.generateInviteCode} modifiers={[disabled(busy || model.inviteCodesRemaining <= 0), foregroundStyle(busy || model.inviteCodesRemaining <= 0 ? theme.tertiary : theme.blue)]} />
    </SwiftUISection> : null}

    {list.isLoading ? <SwiftUISection><SwiftUIHStack spacing={10}><SwiftUIProgressView /><SwiftUIText modifiers={[foregroundStyle('secondary')]}>Loading friends…</SwiftUIText></SwiftUIHStack></SwiftUISection> : null}
    {list.error ? <SwiftUISection footer={<SwiftUIText modifiers={[foregroundStyle('secondary')]}>{list.error.message}</SwiftUIText>}><SwiftUIButton label="Try Again" systemImage="arrow.clockwise" onPress={() => void list.refetch()} /></SwiftUISection> : null}

    {data && data.incoming.length > 0 ? <SwiftUISection header={<NativeCountHeader title="Friend requests" count={data.incoming.length} />}>
      {data.incoming.map((connection) => <NativePersonRow key={connection.requestId} profile={connection.profile} detail={model.requestDetail('Requested', connection)} onOpen={() => model.openProfile(connection.profile)} trailing={<SwiftUIHStack spacing={8}>
        <NativeRowButton prominent label={pending.has(`accept:${connection.requestId}`) ? 'Accepting…' : 'Accept'} isDisabled={pending.has(`accept:${connection.requestId}`)} onPress={() => actions.accept(connection)} />
        <NativeMenu name={connection.profile.displayName} actions={model.requestMenu(connection)} />
      </SwiftUIHStack>} />)}
    </SwiftUISection> : null}

    {poolInvitations.length > 0 ? <SwiftUISection title="Pool invitations" footer={currentPool ? <SwiftUIText modifiers={[foregroundStyle('secondary')]}>{LEAVE_CURRENT_FIRST}</SwiftUIText> : undefined}>
      {poolInvitations.map((invitation) => <NativePersonRow key={invitation.id} profile={invitation.inviter} detail={invitationMembersLabel(invitation.memberCount)} onOpen={() => model.openProfile(invitation.inviter)} trailing={<SwiftUIHStack spacing={8}>
        <NativeRowButton prominent label="Join" isDisabled={busy || Boolean(currentPool) || !pool.isSuccess} onPress={() => actions.joinPool(invitation)} />
        <NativeMenu name={invitation.inviter.displayName} actions={model.poolInvitationMenu(invitation)} />
      </SwiftUIHStack>} />)}
    </SwiftUISection> : null}

    {pool.error ? <SwiftUISection footer={<SwiftUIText modifiers={[foregroundStyle('secondary')]}>{pool.error.message}</SwiftUIText>}><SwiftUIButton label="Try Again" systemImage="arrow.clockwise" onPress={() => void pool.refetch()} /></SwiftUISection> : null}
    {currentPool ? <>
      <SwiftUISection title="Pool" footer={<SwiftUIText modifiers={[foregroundStyle('secondary')]}>{poolMembersLabel(currentPool)}</SwiftUIText>}>
        {poolUsageRows(currentPool).map((row) => <NativeUsageLimit key={row.key} row={row} />)}
        {currentPool.members.map((member) => {
          const self = member.profile.id === viewerId
          const menu = self ? [] : model.memberMenu(member)
          return <NativePersonRow key={member.profile.id} profile={member.profile} owner={member.owner} detail={self ? 'You' : undefined} onOpen={() => model.openProfile(member.profile)} trailing={menu.length ? <NativeMenu name={member.profile.displayName} actions={menu} /> : undefined} />
        })}
      </SwiftUISection>
      {overview.isOwner && currentPool.pendingInvitations.length > 0 ? <SwiftUISection title="Pending invitations" footer={<SwiftUIText modifiers={[foregroundStyle('secondary')]}>{POOL_SEATS_FOOTER}</SwiftUIText>}>
        {currentPool.pendingInvitations.map((invitation) => <NativePersonRow key={invitation.id} profile={invitation.invitee} onOpen={() => model.openProfile(invitation.invitee)} trailing={<NativeRowButton label="Cancel" isDisabled={busy} onPress={() => actions.cancelPoolInvitation(invitation)} />} />)}
      </SwiftUISection> : null}
      <SwiftUISection footer={overview.mustTransfer ? <SwiftUIText modifiers={[foregroundStyle('secondary')]}>{TRANSFER_FIRST}</SwiftUIText> : undefined}>
        {/* A disabled form button keeps its colors; dim it like the rest of the app does. */}
        <SwiftUIButton label="Leave Pool" systemImage="rectangle.portrait.and.arrow.right" role="destructive" onPress={actions.leavePool} modifiers={[disabled(busy || overview.mustTransfer), foregroundStyle(busy || overview.mustTransfer ? theme.tertiary : theme.red)]} />
      </SwiftUISection>
    </> : null}

    {data ? <SwiftUISection footer={<SwiftUIText modifiers={[foregroundStyle('secondary')]}>{LEADERBOARD_DETAIL}</SwiftUIText>}>
      <NativeLinkRow icon="chart.bar.fill" title="Leaderboard" onPress={model.openLeaderboard} />
    </SwiftUISection> : null}

    {data ? <SwiftUISection header={<NativeCountHeader title="Friends" count={overview.friends.length} />}>
      {overview.friends.length ? overview.friends.map((connection) => <NativePersonRow
        key={connection.requestId}
        profile={connection.profile}
        detail={overview.invitedIds.has(connection.profile.id) ? 'Invitation sent' : undefined}
        onOpen={() => model.openProfile(connection.profile)}
        trailing={<NativeMenu name={connection.profile.displayName} actions={model.friendRowMenu(connection.profile)} />}
      />) : <SwiftUIVStack alignment="leading" spacing={3} modifiers={[frame({ maxWidth: Infinity, alignment: 'leading' })]}>
        <SwiftUIText modifiers={[font({ textStyle: 'subheadline', weight: 'medium' })]}>{data.friends.length ? ALL_IN_POOL : EMPTY_TITLE}</SwiftUIText>
        {data.friends.length ? null : <SwiftUIText modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary')]}>{EMPTY_DETAIL}</SwiftUIText>}
      </SwiftUIVStack>}
    </SwiftUISection> : null}

    {model.suggestions.length > 0 ? <SwiftUISection
      header={<NativeCountHeader title="People you may know" count={model.suggestions.length} />}
    >
      {model.suggestions.map((suggestion) => <NativePersonRow
        key={suggestion.profile.id}
        profile={suggestion.profile}
        detail={mutualFriendsLabel(suggestion.mutualFriends.length)}
        onOpen={() => model.openProfile(suggestion.profile)}
        trailing={<SwiftUIHStack spacing={10}>
          <SwiftUIButton label="Dismiss" systemImage="xmark" onPress={() => actions.dismissSuggestion(suggestion)} modifiers={[labelStyle('iconOnly'), buttonStyle('borderless'), foregroundStyle('secondary'), accessibilityLabel(`Dismiss ${suggestion.profile.displayName}`), disabled(suggestionBusy(pending, suggestion.profile.id))]} />
          <NativeRowButton prominent label={pending.has(`request:${suggestion.profile.id}`) ? 'Sending…' : 'Add'} isDisabled={suggestionBusy(pending, suggestion.profile.id)} onPress={() => actions.sendSuggestion(suggestion)} />
        </SwiftUIHStack>}
      />)}
    </SwiftUISection> : null}

    {data && data.outgoing.length > 0 ? <SwiftUISection>
      <SwiftUIDisclosureGroup label={`Sent requests (${data.outgoing.length})`} isExpanded={sentOpen} onIsExpandedChange={setSentOpen}>
        {data.outgoing.map((connection) => <NativePersonRow key={connection.requestId} profile={connection.profile} detail={model.requestDetail('Sent', connection)} onOpen={() => model.openProfile(connection.profile)} trailing={<NativeRowButton label={pending.has(`cancel:${connection.requestId}`) ? 'Canceling…' : 'Cancel'} isDisabled={pending.has(`cancel:${connection.requestId}`)} onPress={() => actions.cancelRequest(connection)} />} />)}
      </SwiftUIDisclosureGroup>
    </SwiftUISection> : null}

    {data && data.blocked.length > 0 ? <SwiftUISection>
      <SwiftUIDisclosureGroup label={`Blocked users (${data.blocked.length})`} isExpanded={blockedOpen} onIsExpandedChange={setBlockedOpen}>
        {data.blocked.map((profile) => <NativePersonRow key={profile.id} profile={profile} trailing={<NativeRowButton label={pending.has(`unblock:${profile.id}`) ? 'Unblocking…' : 'Unblock'} isDisabled={pending.has(`unblock:${profile.id}`)} onPress={() => actions.unblock(profile)} />} />)}
      </SwiftUIDisclosureGroup>
    </SwiftUISection> : null}
  </SwiftUIForm></SwiftUIHost>
}

// Android: Material cards and rows, like the rest of Settings there.

function MaterialMenuButton({ name, actions }: { name: string; actions: FriendMenuAction[] }) {
  if (!actions.length) return null
  return <MaterialIconButton icon="ellipsis" label={`More options for ${name}`} onPress={() => showActions(name, actions)} />
}

function MaterialCollapsible({ title, count, open, onToggle, children }: { title: string; count: number; open: boolean; onToggle: () => void; children: ReactNode }) {
  return <Card style={styles.collapsible}>
    <MaterialNavigationRow title={title} value={`${count}`} expanded={open} onPress={onToggle} />
    {open ? children : null}
  </Card>
}

function MaterialFriends({ model, onBack }: { model: FriendsScreenModel; onBack: () => void }) {
  const theme = useAppTheme()
  const { user, list, pool, currentPool, poolInvitations, overview, inviteCodes, search, pending, busy, copied, actions } = model
  const [sentOpen, setSentOpen] = useState(false)
  const [blockedOpen, setBlockedOpen] = useState(false)
  const data = list.data
  const status = search.ready ? searchStatus(model) : null
  const viewerId = user?.id
  const usageRows = currentPool ? poolUsageRows(currentPool) : []

  return <Screen>
    <PageHeader title="Friends" onBack={onBack} />
    {user ? <Pressable accessibilityRole="button" accessibilityLabel={`Copy @${user.username}`} onPress={actions.copyHandle} style={styles.handle}>
      <Text style={[styles.helper, { color: theme.secondary }]}>Your handle is <Text style={{ color: theme.text }}>{`@${user.username}`}</Text></Text>
      <SymbolView name={copied === 'handle' ? 'checkmark' : 'doc.on.doc'} size={14} tintColor={copied === 'handle' ? theme.green : theme.secondary} />
    </Pressable> : null}
    <Field label="Search friends" placeholder={SEARCH_PLACEHOLDER} value={model.searchInput} onChangeText={model.setSearchInput} autoCapitalize="none" autoCorrect={false} maxLength={120} />
    {search.ready ? <Card>
      {status ? <Text style={[styles.status, { color: theme.secondary }]}>{status}</Text> : null}
      {search.results.map((result, index) => <MaterialPersonRow key={result.profile.id} profile={result.profile} last={index === search.results.length - 1} onOpen={() => model.openProfile(result.profile)}>
        {result.relationship === 'none' ? <MaterialButton compact label="Add" icon="person.badge.plus" loading={pending.has(`request:${result.profile.id}`)} onPress={() => actions.sendRequest(result)} />
          : result.relationship === 'incoming' ? <MaterialButton compact label="Accept" loading={pending.has(`accept:${result.requestId}`)} onPress={() => actions.acceptSearchResult(result)} />
            : <Text style={[styles.helper, { color: result.relationship === 'friends' ? theme.green : theme.secondary }]}>{result.relationship === 'friends' ? 'Friends' : result.relationship === 'outgoing' ? 'Request sent' : 'You'}</Text>}
      </MaterialPersonRow>)}
    </Card> : null}

    {inviteCodes ? <>
      <SectionTitle>Invite codes</SectionTitle>
      <Card>
        {inviteCodes.codes.map((code) => <ListRow key={code.id} title={code.code}>
          <MaterialIconButton icon={copied === code.id ? 'checkmark' : 'doc.on.doc'} label={`Copy ${code.code}`} onPress={() => actions.copyInviteCode(code.id, code.code)} />
          <MaterialIconButton icon="trash" label={`Revoke ${code.code}`} disabled={busy} onPress={() => actions.revokeInviteCode(code.id)} />
        </ListRow>)}
        <ListRow icon="plus" title="Generate invite code" detail={`${model.inviteCodesRemaining} of ${inviteCodes.quota} remaining`} last onPress={busy || model.inviteCodesRemaining <= 0 ? undefined : actions.generateInviteCode} />
      </Card>
    </> : null}

    {list.isLoading ? <Text style={[styles.status, { color: theme.secondary }]}>Loading friends…</Text> : null}
    {list.error ? <Card><ListRow icon="arrow.clockwise" iconColor={theme.blue} title="Friends could not be loaded" detail={`${list.error.message} Tap to retry.`} last onPress={() => void list.refetch()} /></Card> : null}

    {data && data.incoming.length > 0 ? <>
      <SectionTitle trailing={<Text style={[styles.helper, { color: theme.secondary }]}>{data.incoming.length}</Text>}>Friend requests</SectionTitle>
      <Card>{data.incoming.map((connection, index) => <MaterialPersonRow key={connection.requestId} profile={connection.profile} detail={model.requestDetail('Requested', connection)} last={index === data.incoming.length - 1} onOpen={() => model.openProfile(connection.profile)}>
        <MaterialButton compact label="Accept" loading={pending.has(`accept:${connection.requestId}`)} onPress={() => actions.accept(connection)} />
        <MaterialMenuButton name={connection.profile.displayName} actions={model.requestMenu(connection)} />
      </MaterialPersonRow>)}</Card>
    </> : null}

    {poolInvitations.length > 0 ? <>
      <SectionTitle>Pool invitations</SectionTitle>
      <Card>{poolInvitations.map((invitation, index) => <MaterialPersonRow key={invitation.id} profile={invitation.inviter} detail={invitationMembersLabel(invitation.memberCount)} last={index === poolInvitations.length - 1} onOpen={() => model.openProfile(invitation.inviter)}>
        <MaterialButton compact label="Join" disabled={busy || Boolean(currentPool) || !pool.isSuccess} onPress={() => actions.joinPool(invitation)} />
        <MaterialMenuButton name={invitation.inviter.displayName} actions={model.poolInvitationMenu(invitation)} />
      </MaterialPersonRow>)}</Card>
      {currentPool ? <Text style={[styles.helper, styles.footer, { color: theme.secondary }]}>{LEAVE_CURRENT_FIRST}</Text> : null}
    </> : null}

    {pool.error ? <Card style={styles.spaced}><ListRow icon="arrow.clockwise" iconColor={theme.blue} title="Pool could not be loaded" detail={`${pool.error.message} Tap to retry.`} last onPress={() => void pool.refetch()} /></Card> : null}
    {currentPool ? <>
      <SectionTitle trailing={<Text style={[styles.helper, { color: theme.secondary }]}>{poolMembersLabel(currentPool)}</Text>}>Pool</SectionTitle>
      {usageRows.length ? <Card style={styles.usage}>{usageRows.map((row, index) => <UsageLimitCard key={row.key} row={row} last={index === usageRows.length - 1} />)}</Card> : null}
      <Card>{currentPool.members.map((member, index) => {
        const self = member.profile.id === viewerId
        return <MaterialPersonRow key={member.profile.id} profile={member.profile} owner={member.owner} detail={self ? 'You' : undefined} last={index === currentPool.members.length - 1} onOpen={() => model.openProfile(member.profile)}>
          {self ? null : <MaterialMenuButton name={member.profile.displayName} actions={model.memberMenu(member)} />}
        </MaterialPersonRow>
      })}</Card>
      {overview.isOwner && currentPool.pendingInvitations.length > 0 ? <>
        <SectionTitle>Pending invitations</SectionTitle>
        <Card>{currentPool.pendingInvitations.map((invitation, index) => <MaterialPersonRow key={invitation.id} profile={invitation.invitee} last={index === currentPool.pendingInvitations.length - 1} onOpen={() => model.openProfile(invitation.invitee)}>
          <MaterialButton compact variant="plain" label="Cancel" disabled={busy} onPress={() => actions.cancelPoolInvitation(invitation)} />
        </MaterialPersonRow>)}</Card>
        <Text style={[styles.helper, styles.footer, { color: theme.secondary }]}>{POOL_SEATS_FOOTER}</Text>
      </> : null}
      <Card style={styles.spaced}><ListRow icon="rectangle.portrait.and.arrow.right" iconColor={theme.red} title="Leave Pool" detail={overview.mustTransfer ? TRANSFER_FIRST : undefined} destructive last onPress={busy || overview.mustTransfer ? undefined : actions.leavePool} /></Card>
    </> : null}

    {data ? <>
      <Card style={styles.spaced}><ListRow icon="chart.bar.fill" title="Leaderboard" detail={LEADERBOARD_DETAIL} last onPress={model.openLeaderboard} /></Card>
      <SectionTitle trailing={<Text style={[styles.helper, { color: theme.secondary }]}>{overview.friends.length}</Text>}>Friends</SectionTitle>
      {overview.friends.length ? <Card>{overview.friends.map((connection, index) => <MaterialPersonRow key={connection.requestId} profile={connection.profile} detail={overview.invitedIds.has(connection.profile.id) ? 'Invitation sent' : undefined} last={index === overview.friends.length - 1} onOpen={() => model.openProfile(connection.profile)}>
        <MaterialMenuButton name={connection.profile.displayName} actions={model.friendRowMenu(connection.profile)} />
      </MaterialPersonRow>)}</Card>
        : data.friends.length ? <Card><Text style={[styles.status, { color: theme.secondary }]}>{ALL_IN_POOL}</Text></Card>
          : <EmptyState icon="person.2" title={EMPTY_TITLE} detail={EMPTY_DETAIL} />}
      {model.suggestions.length > 0 ? <>
        <SectionTitle trailing={<Text style={[styles.helper, { color: theme.secondary }]}>{model.suggestions.length}</Text>}>People you may know</SectionTitle>
        <Card>{model.suggestions.map((suggestion, index) => <MaterialPersonRow key={suggestion.profile.id} profile={suggestion.profile} detail={mutualFriendsLabel(suggestion.mutualFriends.length)} last={index === model.suggestions.length - 1} onOpen={() => model.openProfile(suggestion.profile)}>
          <MaterialIconButton icon="xmark" label={`Dismiss ${suggestion.profile.displayName}`} disabled={suggestionBusy(pending, suggestion.profile.id)} onPress={() => actions.dismissSuggestion(suggestion)} />
          <MaterialButton compact label="Add" icon="person.badge.plus" loading={pending.has(`request:${suggestion.profile.id}`)} disabled={pending.has(`dismiss:${suggestion.profile.id}`)} onPress={() => actions.sendSuggestion(suggestion)} />
        </MaterialPersonRow>)}</Card>
      </> : null}
      {data.outgoing.length > 0 ? <MaterialCollapsible title="Sent requests" count={data.outgoing.length} open={sentOpen} onToggle={() => setSentOpen((open) => !open)}>
        {data.outgoing.map((connection, index) => <MaterialPersonRow key={connection.requestId} profile={connection.profile} detail={model.requestDetail('Sent', connection)} last={index === data.outgoing.length - 1} onOpen={() => model.openProfile(connection.profile)}>
          <MaterialButton compact variant="plain" label="Cancel" loading={pending.has(`cancel:${connection.requestId}`)} onPress={() => actions.cancelRequest(connection)} />
        </MaterialPersonRow>)}
      </MaterialCollapsible> : null}
      {data.blocked.length > 0 ? <MaterialCollapsible title="Blocked users" count={data.blocked.length} open={blockedOpen} onToggle={() => setBlockedOpen((open) => !open)}>
        {data.blocked.map((profile, index) => <MaterialPersonRow key={profile.id} profile={profile} last={index === data.blocked.length - 1}>
          <MaterialButton compact variant="secondary" label="Unblock" loading={pending.has(`unblock:${profile.id}`)} onPress={() => actions.unblock(profile)} />
        </MaterialPersonRow>)}
      </MaterialCollapsible> : null}
    </> : null}
  </Screen>
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  handle: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 14, paddingHorizontal: 4 },
  helper: { fontSize: 12, lineHeight: 18 },
  footer: { marginTop: 8, paddingHorizontal: 4 },
  status: { fontSize: 14, lineHeight: 20, padding: 15, textAlign: 'center' },
  collapsible: { marginTop: 16 },
  spaced: { marginTop: 16 },
  usage: { marginBottom: 12 },
})
