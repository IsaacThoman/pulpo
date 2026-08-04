import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  Alert, Button as RNButton, Image, Platform, ScrollView, Share, StyleSheet, Text, View,
} from 'react-native';
import * as Network from 'expo-network';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import {
  Button as SwiftUIButton,
  Form as SwiftUIForm,
  HStack as SwiftUIHStack,
  Host as SwiftUIHost,
  Image as SwiftUIImage,
  LabeledContent as SwiftUILabeledContent,
  Menu as SwiftUIMenu,
  ProgressView as SwiftUIProgressView,
  Section as SwiftUISection,
  SecureField as SwiftUISecureField,
  Spacer as SwiftUISpacer,
  Text as SwiftUIText,
  TextField as SwiftUITextField,
  Toggle as SwiftUIToggle,
  VStack as SwiftUIVStack,
  useNativeState,
} from '@expo/ui/swift-ui';
import { buttonStyle, contentShape, font, foregroundStyle, frame, lineLimit, multilineTextAlignment, shapes, textFieldStyle, tint } from '@expo/ui/swift-ui/modifiers';
import { Badge, Card, EmptyState, Field, GlassIconButton, ListRow, NativeSwitch, PageHeader, PrimaryButton, Screen, SectionTitle, Segmented } from '../components/PrototypeUI';
import { useAppTheme } from '../theme';
import { usePrototypeStore } from '../store/prototypeStore';
import type { PrototypeChat } from '../domain';
import type { RootStackParamList, SettingsSection } from '../navigation';
import { apiRequest, mobileApi } from '../../../api/client';
import { useSessionStore } from '../../../store/session';
import { useRealtimeStore } from '../../../providers/realtimeStore';
import { SafeMarkdown } from '../../../components/SafeMarkdown';
import { projectSharedMessages, type PublicShareResponse } from '../../../features/chat/shared';

const relative = (timestamp: number) => {
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return 'now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return `${Math.floor(delta / 86_400_000)}d`;
};

const formatBytes = (value: number) => value < 1024 * 1024
  ? `${Math.round(value / 1024)} KB`
  : value < 1024 * 1024 * 1024
    ? `${(value / 1024 / 1024).toFixed(1)} MB`
    : `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;

const pulpoSmiley = require('../../assets/pulpo-smiley.png');

export function SearchScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Search'>) {
  const theme = useAppTheme();
  const storedChats = usePrototypeStore((state) => state.chats);
  const chats = useMemo(() => storedChats.filter((chat) => chat.deletedAt === null), [storedChats]);
  const recent = usePrototypeStore((state) => state.recentSearches);
  const addRecent = usePrototypeStore((state) => state.addRecentSearch);
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();
  const results = useMemo(() => normalized ? chats.flatMap((chat) => {
    const matchingMessages = chat.messages.filter((message) => message.text.toLowerCase().includes(normalized));
    return chat.title.toLowerCase().includes(normalized) || matchingMessages.length ? [{ chat, excerpt: matchingMessages[0]?.text ?? chat.messages.at(-1)?.text ?? '' }] : [];
  }) : [], [chats, normalized]);
  const open = (chat: PrototypeChat) => { if (query.trim()) addRecent(query); navigation.navigate('Chat', { chatId: chat.id }); };
  return <Screen scroll={false}><PageHeader title="Search" subtitle="Chats and messages" onBack={() => navigation.goBack()} />
    <Field autoFocus accessibilityLabel="Search chats and messages" autoCapitalize="none" placeholder="Search chats and messages…" value={query} onChangeText={setQuery} />
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={styles.searchResults}>
      {!normalized && <><SectionTitle>Recent searches</SectionTitle><Card>{recent.map((item, index) => <ListRow key={item} icon="clock" title={item} last={index === recent.length - 1} onPress={() => setQuery(item)} />)}</Card><SectionTitle>Search tips</SectionTitle><Text style={[styles.helper, { color: theme.secondary }]}>Search looks through chat titles and the full text of every cached message. Try a model name, code symbol, or phrase you remember.</Text></>}
      {normalized && results.length === 0 ? <EmptyState icon="magnifyingglass" title="No results" detail={`Nothing in your local chat history matches “${query.trim()}”.`} /> : null}
      {results.length ? <Card>{results.map(({ chat, excerpt }, index) => <ListRow key={chat.id} icon="bubble.left.and.text.bubble.right" title={chat.title} detail={excerpt} value={relative(chat.updatedAt)} last={index === results.length - 1} onPress={() => open(chat)} />)}</Card> : null}
    </ScrollView>
  </Screen>;
}

function NativeDestinationRow({ icon, title, detail, onPress }: { icon: string; title: string; detail?: string; onPress: () => void }) {
  return <SwiftUIButton onPress={onPress} modifiers={[buttonStyle('plain'), foregroundStyle('primary')]}><SwiftUIHStack spacing={12} modifiers={[contentShape(shapes.rectangle())]}><SwiftUIImage systemName={icon as never} size={17} modifiers={[frame({ width: 22, height: 22 })]} /><SwiftUIText>{title}</SwiftUIText><SwiftUISpacer />{detail ? <SwiftUIText modifiers={[foregroundStyle('secondary'), font({ textStyle: 'footnote' })]}>{detail}</SwiftUIText> : null}<SwiftUIImage systemName="chevron.right" size={11} modifiers={[foregroundStyle('secondary')]} /></SwiftUIHStack></SwiftUIButton>;
}

export function AccountScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Account'>) {
  const theme = useAppTheme();
  const session = usePrototypeStore((state) => state.session);
  const instance = usePrototypeStore((state) => state.instance);
  const signOut = useSessionStore((state) => state.logout);
  const user = session.user;
  const confirmSignOut = () => Alert.alert('Sign out?', 'End this session on this device.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: signOut }]);

  if (Platform.OS === 'ios') return <SwiftUIHost modifiers={[tint(theme.text)]} style={styles.flex}><SwiftUIForm>
    <SwiftUISection title="Profile">
      <SwiftUILabeledContent label="Name"><SwiftUIText>{user?.name ?? 'Pulpo Member'}</SwiftUIText></SwiftUILabeledContent>
      <SwiftUILabeledContent label="Email"><SwiftUIText modifiers={[foregroundStyle('secondary')]}>{user?.email ?? ''}</SwiftUIText></SwiftUILabeledContent>
      <SwiftUILabeledContent label="Role"><SwiftUIText modifiers={[foregroundStyle('secondary')]}>Member</SwiftUIText></SwiftUILabeledContent>
      <NativeDestinationRow icon="person.crop.circle" title="Edit Profile" onPress={() => navigation.navigate('EditProfile')} />
    </SwiftUISection>
    <SwiftUISection title="Security"><NativeDestinationRow icon="lock.rotation" title="Change Password" onPress={() => navigation.navigate('ChangePassword')} /></SwiftUISection>
    <SwiftUISection title="Server"><NativeDestinationRow icon="network" title="Pulpo Instance" detail={instance.version} onPress={() => navigation.navigate('InstanceDetails')} /></SwiftUISection>
    <SwiftUISection title="Session"><SwiftUIButton label="Sign Out" role="destructive" systemImage="rectangle.portrait.and.arrow.right" onPress={confirmSignOut} /></SwiftUISection>
  </SwiftUIForm></SwiftUIHost>;

  return <Screen><PageHeader title="Account" onBack={() => navigation.goBack()} /><SectionTitle>Profile</SectionTitle><Card><ListRow title="Name" value={user?.name ?? 'Pulpo Member'} /><ListRow title="Email" value={user?.email ?? ''} /><ListRow title="Role" value="Member" /><ListRow icon="person.crop.circle" title="Edit profile" last onPress={() => navigation.navigate('EditProfile')} /></Card><SectionTitle>Security</SectionTitle><Card><ListRow icon="lock.rotation" title="Change password" last onPress={() => navigation.navigate('ChangePassword')} /></Card><SectionTitle>Server</SectionTitle><Card><ListRow icon="network" title="Pulpo instance" value={instance.version} last onPress={() => navigation.navigate('InstanceDetails')} /></Card><SectionTitle>Session</SectionTitle><Card><ListRow icon="rectangle.portrait.and.arrow.right" iconColor={theme.red} title="Sign out" destructive last onPress={confirmSignOut} /></Card></Screen>;
}

export function EditProfileScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'EditProfile'>) {
  const theme = useAppTheme();
  const session = usePrototypeStore((state) => state.session);
  const updateProfile = usePrototypeStore((state) => state.updateProfile);
  const setProductionUser = useSessionStore((state) => state.setUser);
  const [name, setName] = useState(session.user?.name ?? '');
  const save = useCallback(() => {
    if (!name.trim()) return;
    void mobileApi.updateProfile(name.trim()).then(({ user }) => {
      setProductionUser(user);
      updateProfile({ name: user.name });
      navigation.goBack();
    }).catch((error) => Alert.alert('Couldn’t update profile', error instanceof Error ? error.message : undefined));
  }, [name, navigation, setProductionUser, updateProfile]);

  useLayoutEffect(() => {
    if (Platform.OS !== 'ios') return;
    navigation.setOptions({
      headerLeft: () => <RNButton title="Cancel" onPress={() => navigation.goBack()} />,
      headerRight: () => <RNButton title="Done" disabled={!name.trim()} onPress={save} />,
    });
  }, [name, navigation, save]);

  if (Platform.OS === 'ios') return <SwiftUIHost modifiers={[tint(theme.text)]} style={styles.flex}><SwiftUIForm><SwiftUISection title="Profile" footer={<SwiftUIText modifiers={[foregroundStyle('secondary')]}>This is the name shown on your Pulpo account.</SwiftUIText>}><NativeFormTextField title="Name" value={name} onChange={setName} /><SwiftUILabeledContent label="Email"><SwiftUIText modifiers={[foregroundStyle('secondary')]}>{session.user?.email ?? ''}</SwiftUIText></SwiftUILabeledContent></SwiftUISection></SwiftUIForm></SwiftUIHost>;
  return <Screen><PageHeader title="Edit Profile" onBack={() => navigation.goBack()} /><Field label="Display name" value={name} onChangeText={setName} /><PrimaryButton label="Save" onPress={save} /></Screen>;
}

function NativePasswordField({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (value: string) => void }) {
  const nativeText = useNativeState(value);
  useEffect(() => { if (nativeText.get() !== value) nativeText.set(value); }, [nativeText, value]);
  return <SwiftUISecureField placeholder={placeholder} text={nativeText} onTextChange={onChange} />;
}

export function ChangePasswordScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'ChangePassword'>) {
  const theme = useAppTheme();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const valid = Boolean(current && next.length >= 8 && next === confirmation);
  const submit = () => {
    if (!valid) return;
    void mobileApi.changePassword(current, next).then(() => Alert.alert('Password updated', 'Your other sessions remain signed in.', [{ text: 'Done', onPress: () => navigation.goBack() }])).catch((error) => Alert.alert('Couldn’t update password', error instanceof Error ? error.message : undefined));
  };

  if (Platform.OS === 'ios') return <SwiftUIHost modifiers={[tint(theme.text)]} style={styles.flex}><SwiftUIForm><SwiftUISection title="Password" footer={<SwiftUIText modifiers={[foregroundStyle('secondary')]}>Use at least 8 characters. Other signed-in devices will remain active.</SwiftUIText>}><NativePasswordField placeholder="Current password" value={current} onChange={setCurrent} /><NativePasswordField placeholder="New password" value={next} onChange={setNext} /><NativePasswordField placeholder="Confirm new password" value={confirmation} onChange={setConfirmation} /></SwiftUISection><SwiftUISection><SwiftUIButton label="Update Password" systemImage="checkmark" onPress={submit} modifiers={[buttonStyle('borderedProminent'), frame({ maxWidth: Infinity })]} /></SwiftUISection></SwiftUIForm></SwiftUIHost>;
  return <Screen><PageHeader title="Change Password" onBack={() => navigation.goBack()} /><Field label="Current password" secureTextEntry value={current} onChangeText={setCurrent} /><Field label="New password" secureTextEntry value={next} onChangeText={setNext} /><Field label="Confirm new password" secureTextEntry value={confirmation} onChangeText={setConfirmation} /><PrimaryButton label="Update password" disabled={!valid} onPress={submit} /></Screen>;
}

export function InstanceDetailsScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'InstanceDetails'>) {
  const theme = useAppTheme();
  const instance = usePrototypeStore((state) => state.instance);
  const realtimeConnected = useRealtimeStore((state) => state.connected);
  const networkState = Network.useNetworkState();
  const connectionLabel = networkState.isConnected === false || networkState.isInternetReachable === false
    ? 'Offline' : realtimeConnected ? 'Connected' : 'Reconnecting';
  if (Platform.OS === 'ios') return <SwiftUIHost modifiers={[tint(theme.text)]} style={styles.flex}><SwiftUIForm><SwiftUISection title="Connection"><SwiftUILabeledContent label="Status"><SwiftUIText>{connectionLabel}</SwiftUIText></SwiftUILabeledContent><SwiftUILabeledContent label="Name"><SwiftUIText>{instance.name}</SwiftUIText></SwiftUILabeledContent><SwiftUILabeledContent label="Version"><SwiftUIText>{instance.version}</SwiftUIText></SwiftUILabeledContent></SwiftUISection><SwiftUISection title="Endpoints"><SwiftUILabeledContent label="Server"><SwiftUIText modifiers={[foregroundStyle('secondary'), font({ textStyle: 'footnote' })]}>{instance.url}</SwiftUIText></SwiftUILabeledContent><SwiftUILabeledContent label="API"><SwiftUIText modifiers={[foregroundStyle('secondary'), font({ textStyle: 'footnote' })]}>{`${instance.url}/v1`}</SwiftUIText></SwiftUILabeledContent></SwiftUISection></SwiftUIForm></SwiftUIHost>;
  return <Screen><PageHeader title="Pulpo Instance" onBack={() => navigation.goBack()} /><Card><ListRow title="Status" value={connectionLabel} /><ListRow title="Name" value={instance.name} /><ListRow title="Version" value={instance.version} /><ListRow title="Server" detail={instance.url} /><ListRow title="API" detail={`${instance.url}/v1`} last /></Card></Screen>;
}

type SettingsDestination = SettingsSection | 'trash';

const settingsSections: { id: SettingsDestination; title: string; detail: string; icon: string }[] = [
  { id: 'general', title: 'General', detail: 'Appearance and keyboard behavior', icon: 'slider.horizontal.3' },
  { id: 'interface', title: 'Interface', detail: 'Streaming, reasoning, accessibility', icon: 'rectangle.3.group' },
  { id: 'data', title: 'Data Controls', detail: 'Storage and deletion', icon: 'externaldrive' },
  { id: 'trash', title: 'Trash', detail: 'Retention, restore, permanent deletion', icon: 'trash' },
];

export function MemberSettingsScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Settings'>) {
  const theme = useAppTheme(); const session = usePrototypeStore((state) => state.session); const instance = usePrototypeStore((state) => state.instance);
  const open = (section: SettingsDestination) => section === 'trash' ? navigation.navigate('Trash') : navigation.navigate('SettingsDetail', { section });
  if (Platform.OS === 'ios') return <SwiftUIHost modifiers={[tint(theme.text)]} style={styles.flex}><SwiftUIForm><SwiftUISection><SwiftUIButton modifiers={[buttonStyle('plain'), foregroundStyle('primary')]} onPress={() => navigation.navigate('Account')}><SwiftUIHStack spacing={12} modifiers={[contentShape(shapes.rectangle())]}><SwiftUIImage systemName="person.crop.circle.fill" size={42} /><SwiftUIVStack alignment="leading" spacing={2}><SwiftUIText modifiers={[font({ textStyle: 'headline' })]}>{session.user?.name ?? 'Pulpo Member'}</SwiftUIText><SwiftUIText modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary')]}>{session.user?.email ?? ''} · Member</SwiftUIText></SwiftUIVStack><SwiftUISpacer /><SwiftUIImage systemName="chevron.right" size={11} color={theme.tertiary} /></SwiftUIHStack></SwiftUIButton></SwiftUISection><SwiftUISection title="Member settings">{settingsSections.slice(0, 2).map((section) => <NativeSettingsLink key={section.id} icon={section.icon} title={section.title} detail={section.detail} onPress={() => open(section.id)} />)}</SwiftUISection><SwiftUISection title="Data and support">{settingsSections.slice(2).map((section) => <NativeSettingsLink key={section.id} icon={section.icon} title={section.title} detail={section.detail} onPress={() => open(section.id)} />)}</SwiftUISection></SwiftUIForm></SwiftUIHost>;
  return <Screen><PageHeader title="Settings" subtitle={new URL(instance.url).hostname} onBack={() => navigation.goBack()} />
    <Card style={styles.profileCard}><View style={[styles.profileAvatar, { backgroundColor: theme.text }]}><Text style={[styles.profileInitials, { color: theme.background }]}>{session.user?.initials ?? '?'}</Text></View><View style={styles.flex}><Text style={[styles.profileName, { color: theme.text }]}>{session.user?.name ?? 'Pulpo Member'}</Text><Text style={[styles.profileEmail, { color: theme.secondary }]}>{session.user?.email}</Text></View><Badge label="Member" color={theme.green} /></Card>
    <SectionTitle>Member settings</SectionTitle><Card>{settingsSections.slice(0, 2).map((section, index) => <ListRow key={section.id} icon={section.icon} title={section.title} detail={section.detail} last={index === 1} onPress={() => open(section.id)} />)}</Card>
    <SectionTitle>Data and support</SectionTitle><Card>{settingsSections.slice(2).map((section, index, list) => <ListRow key={section.id} icon={section.icon} title={section.title} detail={section.detail} last={index === list.length - 1} onPress={() => open(section.id)} />)}</Card>
  </Screen>;
}

function NativeSettingsLink({ icon, title, detail, onPress }: { icon: string; title: string; detail: string; onPress: () => void }) {
  return <SwiftUIButton modifiers={[buttonStyle('plain'), foregroundStyle('primary')]} onPress={onPress}><SwiftUIHStack spacing={12} modifiers={[contentShape(shapes.rectangle())]}><SwiftUIImage systemName={icon as never} size={17} modifiers={[frame({ width: 22, height: 22 })]} /><SwiftUIVStack alignment="leading" spacing={2}><SwiftUIText modifiers={[font({ textStyle: 'subheadline', weight: 'medium' }), lineLimit(1)]}>{title}</SwiftUIText><SwiftUIText modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary'), lineLimit(1)]}>{detail}</SwiftUIText></SwiftUIVStack><SwiftUISpacer /><SwiftUIImage systemName="chevron.right" size={11} /></SwiftUIHStack></SwiftUIButton>;
}

const settingTitles: Record<SettingsSection, string> = { general: 'General', interface: 'Interface', data: 'Data Controls', demo: 'Demo Controls' };

function NativeChoiceRow<T extends string>({ title, value, options, onChange, icon }: { title: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void; icon?: string }) {
  const selected = options.find((option) => option.value === value)?.label ?? value;
  return <SwiftUIMenu label={<SwiftUIHStack spacing={12}>{icon ? <SwiftUIImage systemName={icon as never} size={17} modifiers={[frame({ width: 22, height: 22 })]} /> : null}<SwiftUIText>{title}</SwiftUIText><SwiftUISpacer /><SwiftUIText modifiers={[foregroundStyle('secondary')]}>{selected}</SwiftUIText><SwiftUIImage systemName="chevron.up.chevron.down" size={10} modifiers={[foregroundStyle('secondary')]} /></SwiftUIHStack>} modifiers={[buttonStyle('plain'), foregroundStyle('primary')]}>{options.map((option) => <SwiftUIButton key={option.value} label={option.label} systemImage={option.value === value ? 'checkmark' : undefined} onPress={() => onChange(option.value)} />)}</SwiftUIMenu>;
}

function NativeToggleRow({ title, detail, value, onChange, icon }: { title: string; detail: string; value: boolean; onChange: (value: boolean) => void; icon?: string }) {
  const theme = useAppTheme();
  return <SwiftUIToggle isOn={value} onIsOnChange={onChange} systemImage={icon as never} modifiers={[tint(theme.green)]}><SwiftUIText>{title}</SwiftUIText><SwiftUIText modifiers={[foregroundStyle('secondary'), font({ textStyle: 'footnote' })]}>{detail}</SwiftUIText></SwiftUIToggle>;
}

function NativeFormTextField({ title, value, onChange }: { title: string; value: string; onChange: (value: string) => void }) {
  const nativeText = useNativeState(value);
  useEffect(() => { if (nativeText.get() !== value) nativeText.set(value); }, [nativeText, value]);
  return <SwiftUIHStack spacing={12}><SwiftUIText>{title}</SwiftUIText><SwiftUISpacer /><SwiftUITextField onTextChange={onChange} text={nativeText} modifiers={[textFieldStyle('plain'), multilineTextAlignment('trailing'), frame({ minWidth: 150 })]} /></SwiftUIHStack>;
}

export function SettingsDetailScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'SettingsDetail'>) {
  const section = route.params.section;
  const theme = useAppTheme();
  const preferences = usePrototypeStore((state) => state.preferences);
  const setPreference = usePrototypeStore((state) => state.setPreference);
  const chats = usePrototypeStore((state) => state.chats);
  const trashAllChats = usePrototypeStore((state) => state.trashAllChats);
  const instanceUrl = useSessionStore((state) => state.instanceUrl);
  const userId = useSessionStore((state) => state.user?.id);
  const storage = useQuery({
    queryKey: ['attachment-usage', instanceUrl, userId],
    queryFn: () => apiRequest<{ usedBytes: number; reservedBytes: number; limitBytes: number }>('/api/attachments/usage'),
    enabled: section === 'data' && Boolean(userId),
  });
  const storageUsed = storage.data ? storage.data.usedBytes + storage.data.reservedBytes : 0;
  const storageProgress = storage.data?.limitBytes ? Math.min(1, storageUsed / storage.data.limitBytes) : 0;
  const storageLabel = storage.data ? `${formatBytes(storageUsed)} of ${formatBytes(storage.data.limitBytes)}` : 'Loading…';
  useLayoutEffect(() => {
    if (Platform.OS === 'ios') navigation.setOptions({ title: settingTitles[section] });
  }, [navigation, section]);
  if (Platform.OS === 'ios') return <SwiftUIHost modifiers={[tint(theme.text)]} style={styles.flex}><SwiftUIForm>
    {section === 'general' && <>
      <SwiftUISection title="Appearance">
        <NativeChoiceRow icon="circle.lefthalf.filled" title="Theme" value={preferences.theme} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] as const} onChange={(value) => setPreference('theme', value)} />
      </SwiftUISection>
    </>}
    {section === 'interface' && <>
      <SwiftUISection title="Conversation">
        <NativeToggleRow icon="text.append" title="Stream responses" detail="Render tokens as they arrive." value={preferences.streamResponses} onChange={(value) => setPreference('streamResponses', value)} />
        <NativeToggleRow icon="brain.head.profile" title="Show reasoning" detail="Show expandable work details." value={preferences.showReasoning} onChange={(value) => setPreference('showReasoning', value)} />
        <NativeToggleRow icon="iphone.radiowaves.left.and.right" title="Haptics" detail="Feedback for sends, menus, and completion." value={preferences.haptics} onChange={(value) => setPreference('haptics', value)} />
      </SwiftUISection>
      <SwiftUISection title="Offline storage">
        <SwiftUILabeledContent label="Chats kept on device"><SwiftUIText modifiers={[foregroundStyle('secondary')]}>{`${preferences.localChatLimit}`}</SwiftUIText></SwiftUILabeledContent>
        <SwiftUILabeledContent label="Attachment cache"><SwiftUIText modifiers={[foregroundStyle('secondary')]}>{`${preferences.attachmentCacheMb} MB`}</SwiftUIText></SwiftUILabeledContent>
      </SwiftUISection>
    </>}
    {section === 'data' && <>
      <SwiftUISection title="File storage" footer={<SwiftUIText modifiers={[foregroundStyle('secondary')]}>Uploaded files and model-created files count toward this allowance.</SwiftUIText>}>
        <SwiftUILabeledContent label="Storage used"><SwiftUIText>{storageLabel}</SwiftUIText></SwiftUILabeledContent>
        <SwiftUIProgressView value={storageProgress} />
      </SwiftUISection>
      <SwiftUISection title="Danger zone"><SwiftUIButton label="Trash all chats" role="destructive" systemImage="trash" onPress={() => Alert.alert('Trash all chats?', 'Chats remain recoverable according to your trash retention setting.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Trash all', style: 'destructive', onPress: trashAllChats }])} /></SwiftUISection>
    </>}
  </SwiftUIForm></SwiftUIHost>;
  return <Screen><PageHeader title={settingTitles[section]} onBack={() => navigation.goBack()} />
    {section === 'general' && <><SectionTitle>Appearance</SectionTitle><Card><ListRow title="Theme" detail="Applies across the whole app."><View style={{ width: 178 }}><Segmented options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] as const} value={preferences.theme} onChange={(value) => setPreference('theme', value)} /></View></ListRow></Card></>}
    {section === 'interface' && <><SectionTitle>Conversation</SectionTitle><Card><Toggle title="Stream responses" detail="Render tokens as they arrive." value={preferences.streamResponses} onChange={(value) => setPreference('streamResponses', value)} /><Toggle title="Show reasoning" detail="Show expandable work details." value={preferences.showReasoning} onChange={(value) => setPreference('showReasoning', value)} /><Toggle title="Haptics" detail="Feedback for sends, menus, and completion." value={preferences.haptics} onChange={(value) => setPreference('haptics', value)} last /></Card><SectionTitle>Offline storage</SectionTitle><Card><ListRow title="Chats kept on device" detail="Recent chats remain instantly available." value={`${preferences.localChatLimit}`} /><ListRow title="Attachment cache" detail="Maximum local file data." value={`${preferences.attachmentCacheMb} MB`} last /></Card></>}
    {section === 'data' && <><SectionTitle>File storage</SectionTitle><Card style={styles.storage}><View style={styles.storageLine}><Text style={[styles.storageTitle, { color: theme.text }]}>{storageLabel}</Text><Text style={[styles.storagePercent, { color: theme.secondary }]}>{`${Math.round(storageProgress * 100)}%`}</Text></View><View style={[styles.storageTrack, { backgroundColor: theme.fillStrong }]}><View style={[styles.storageBar, { backgroundColor: theme.blue, width: `${storageProgress * 100}%` }]} /></View><Text style={[styles.helper, { color: theme.secondary }]}>Uploaded files and model-created files count toward this allowance.</Text></Card><SectionTitle>Danger zone</SectionTitle><Card><ListRow icon="trash" iconColor={theme.red} title="Trash all chats" detail={`${chats.filter((chat) => chat.deletedAt === null).length} active chats`} destructive last onPress={() => Alert.alert('Trash all chats?', 'Chats remain recoverable according to your trash retention setting.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Trash all', style: 'destructive', onPress: trashAllChats }])} /></Card></>}
  </Screen>;
}

function Toggle({ title, detail, value, onChange, last = false }: { title: string; detail?: string; value: boolean; onChange: (value: boolean) => void; last?: boolean }) { return <ListRow title={title} detail={detail} last={last}><NativeSwitch label={title} value={value} onChange={onChange} /></ListRow>; }
export function TrashScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Trash'>) {
  const theme = useAppTheme();
  const storedChats = usePrototypeStore((state) => state.chats);
  const chats = useMemo(() => storedChats.filter((chat) => chat.deletedAt !== null), [storedChats]);
  const retention = usePrototypeStore((state) => state.preferences.trashRetention);
  const setPreference = usePrototypeStore((state) => state.setPreference);
  const restore = usePrototypeStore((state) => state.restoreChat);
  const remove = usePrototypeStore((state) => state.permanentlyDeleteChat);
  const empty = usePrototypeStore((state) => state.emptyTrash);
  const confirmEmpty = useCallback(() => Alert.alert('Empty trash?', 'This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete all', style: 'destructive', onPress: empty }]), [empty]);
  useLayoutEffect(() => {
    if (Platform.OS !== 'ios') return;
    navigation.setOptions({ headerRight: chats.length ? () => <RNButton title="Empty" color={theme.red} onPress={confirmEmpty} /> : undefined });
  }, [chats.length, confirmEmpty, navigation, theme.red]);
  if (Platform.OS === 'ios') return <SwiftUIHost modifiers={[tint(theme.text)]} style={styles.flex}><SwiftUIForm>
    <SwiftUISection title="Retention" footer={<SwiftUIText modifiers={[foregroundStyle('secondary')]}>Chats are permanently removed after this period.</SwiftUIText>}>
      <NativeChoiceRow title="Keep trashed chats" value={retention} options={[{ value: 'instant', label: 'No retention' }, { value: '24h', label: '24 hours' }, { value: '7d', label: '7 days' }, { value: '30d', label: '30 days' }, { value: '90d', label: '90 days' }, { value: 'indefinite', label: 'Indefinitely' }] as const} onChange={(value) => setPreference('trashRetention', value)} />
    </SwiftUISection>
    <SwiftUISection title="Trashed chats">
      {chats.length === 0 ? <SwiftUIVStack alignment="center" spacing={8}><SwiftUIImage systemName="trash" size={28} /><SwiftUIText modifiers={[font({ textStyle: 'headline' })]}>Trash is empty</SwiftUIText><SwiftUIText modifiers={[foregroundStyle('secondary'), font({ textStyle: 'footnote' })]}>Deleted chats will appear here when retention is enabled.</SwiftUIText></SwiftUIVStack> : chats.map((chat) => <SwiftUIButton key={chat.id} modifiers={[buttonStyle('plain'), foregroundStyle('primary')]} onPress={() => Alert.alert(chat.title, `Trashed ${relative(chat.deletedAt!)} ago${chat.purgeAt ? `\nDeletes in ${Math.max(1, Math.ceil((chat.purgeAt - Date.now()) / 86_400_000))} days` : '\nKept indefinitely'}`, [{ text: 'Restore', onPress: () => restore(chat.id) }, { text: 'Delete permanently', style: 'destructive', onPress: () => remove(chat.id) }, { text: 'Cancel', style: 'cancel' }])}><SwiftUIHStack spacing={12}><SwiftUIImage systemName="bubble.left" size={17} /><SwiftUIVStack alignment="leading" spacing={2}><SwiftUIText>{chat.title}</SwiftUIText><SwiftUIText modifiers={[foregroundStyle('secondary'), font({ textStyle: 'footnote' })]}>{`Trashed ${relative(chat.deletedAt!)} ago · ${chat.purgeAt ? `deletes in ${Math.max(1, Math.ceil((chat.purgeAt - Date.now()) / 86_400_000))}d` : 'kept indefinitely'}`}</SwiftUIText></SwiftUIVStack><SwiftUISpacer /><SwiftUIImage systemName="ellipsis.circle" size={16} /></SwiftUIHStack></SwiftUIButton>)}
    </SwiftUISection>
  </SwiftUIForm></SwiftUIHost>;
  return <Screen><PageHeader title="Trash" subtitle={`${chats.length} recoverable chat${chats.length === 1 ? '' : 's'}`} onBack={() => navigation.goBack()} right={chats.length ? <GlassIconButton icon="trash.slash" label="Empty trash" onPress={() => Alert.alert('Empty trash?', 'This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete all', style: 'destructive', onPress: empty }])} /> : undefined} />
    <SectionTitle>Retention</SectionTitle><Card><ListRow title="Keep trashed chats" detail="Chats are permanently removed after this period." value={retention === 'indefinite' ? 'Indefinitely' : retention} last onPress={() => Alert.alert('Trash retention', undefined, ['instant', '24h', '7d', '30d', '90d', 'indefinite'].map((value) => ({ text: value === 'instant' ? 'No retention' : value, onPress: () => setPreference('trashRetention', value as typeof retention) })))} /></Card>
    {chats.length === 0 ? <EmptyState icon="trash" title="Trash is empty" detail="Deleted chats will appear here when retention is enabled." /> : <><SectionTitle>Trashed chats</SectionTitle><Card>{chats.map((chat, index) => <ListRow key={chat.id} icon="bubble.left" iconColor={theme.red} title={chat.title} detail={`Trashed ${relative(chat.deletedAt!)} ago · ${chat.purgeAt ? `deletes in ${Math.max(1, Math.ceil((chat.purgeAt - Date.now()) / 86_400_000))}d` : 'kept indefinitely'}`} last={index === chats.length - 1} onPress={() => Alert.alert(chat.title, `Trashed ${relative(chat.deletedAt!)} ago${chat.purgeAt ? `\nDeletes in ${relative(Date.now() - (chat.purgeAt - Date.now()))}` : '\nKept indefinitely'}`, [{ text: 'Restore', onPress: () => restore(chat.id) }, { text: 'Delete permanently', style: 'destructive', onPress: () => remove(chat.id) }, { text: 'Cancel', style: 'cancel' }])} />)}</Card></>}
  </Screen>;
}

type PublicShare = { chat: { title: string; modelId: string }; responses: PublicShareResponse[] };

export function SharedChatScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'SharedChat'>) {
  const theme = useAppTheme();
  const instanceUrl = usePrototypeStore((state) => state.instance.url);
  const [share, setShare] = useState<PublicShare | null>(null);
  const [error, setError] = useState('');
  const url = `${instanceUrl}/share/${route.params.token}`;
  useEffect(() => {
    void fetch(`${instanceUrl}/api/shares/${encodeURIComponent(route.params.token)}`).then(async (response) => {
      if (!response.ok) throw new Error('This share does not exist or has expired.');
      setShare(await response.json() as PublicShare);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not open this share.'));
  }, [instanceUrl, route.params.token]);
  if (error) return <Screen><PageHeader title="Shared Chat" onBack={() => navigation.goBack()} /><EmptyState icon="link.badge.plus" title="Link unavailable" detail={error} /></Screen>;
  if (!share) return <Screen><PageHeader title="Shared Chat" onBack={() => navigation.goBack()} /><EmptyState icon="hourglass" title="Opening shared chat" detail="Loading the public snapshot…" /></Screen>;
  const messages = projectSharedMessages(share.responses);
  return <Screen><PageHeader title="Shared Chat" subtitle="Read-only Pulpo link" onBack={() => navigation.goBack()} right={<GlassIconButton icon="square.and.arrow.up" label="Share link" onPress={() => Share.share({ message: `${share.chat.title}\n${url}`, url })} />} /><View style={styles.sharedIntro}><Image source={pulpoSmiley} style={styles.sharedPulpo} /><Badge label="SHARED FROM PULPO" color={theme.blue} /><Text style={[styles.sharedTitle, { color: theme.text }]}>{share.chat.title}</Text><Text style={[styles.sharedMeta, { color: theme.secondary }]}>{messages.length} messages · {share.chat.modelId}</Text></View>{messages.map((message) => <View key={message.id} style={[styles.sharedMessage, message.role === 'user' ? { backgroundColor: theme.elevated, alignSelf: 'flex-end' } : { alignSelf: 'stretch' }]}><Text style={[styles.sharedRole, { color: theme.secondary }]}>{message.role === 'user' ? 'You' : message.modelId}</Text><SafeMarkdown>{message.text}</SafeMarkdown></View>)}<Text style={[styles.privacyNote, { color: theme.secondary }]}>This is a public, read-only snapshot. Reasoning is never included in shared chats.</Text></Screen>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 }, search: { minHeight: 48, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9 }, searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 }, searchResults: { paddingBottom: 34 }, helper: { fontSize: 12, lineHeight: 18 }, result: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth }, resultIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, resultTitle: { fontSize: 15, fontWeight: '700' }, resultExcerpt: { fontSize: 12, lineHeight: 17, marginTop: 2 }, resultTime: { fontSize: 11 }, privacyNote: { fontSize: 11, lineHeight: 16, textAlign: 'center', marginVertical: 18, paddingHorizontal: 20 },
  profileCard: { flexDirection: 'row', alignItems: 'center', padding: 15, gap: 12 }, profileAvatar: { width: 48, height: 48, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }, profileInitials: { fontSize: 15, fontWeight: '900' }, profileName: { fontSize: 16, fontWeight: '700' }, profileEmail: { fontSize: 12, marginTop: 3 }, storage: { padding: 15 }, storageLine: { flexDirection: 'row', justifyContent: 'space-between' }, storageTitle: { fontSize: 14, fontWeight: '700' }, storagePercent: { fontSize: 12 }, storageTrack: { height: 8, borderRadius: 4, overflow: 'hidden', marginVertical: 11 }, storageBar: { height: 8, borderRadius: 4 }, demoNotice: { padding: 13, borderRadius: 14, fontSize: 12, lineHeight: 18 },
  trashRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, gap: 11 }, trashIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, trashTitle: { fontSize: 14, fontWeight: '700' }, trashMeta: { fontSize: 11, marginTop: 3 }, sharedIntro: { alignItems: 'center', paddingVertical: 28 }, sharedPulpo: { width: 48, height: 48, borderRadius: 16, marginBottom: 13 }, sharedTitle: { fontSize: 23, fontWeight: '800', letterSpacing: -0.5, textAlign: 'center', marginTop: 12 }, sharedMeta: { fontSize: 12, marginTop: 5 }, sharedMessage: { maxWidth: '88%', borderRadius: 18, padding: 14, marginBottom: 16 }, sharedRole: { fontSize: 11, fontWeight: '800', marginBottom: 6 }, sharedText: { fontSize: 15, lineHeight: 23 },
});
