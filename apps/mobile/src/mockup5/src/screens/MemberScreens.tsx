import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  Alert, Button as RNButton, Image, Platform, StyleSheet, Text, View,
} from 'react-native';
import * as Network from 'expo-network';
import * as Clipboard from 'expo-clipboard';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { PasskeyList, PasskeySummary, TwoFactorEnrollment, TwoFactorStatus } from '@pulpo/contracts';
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
import { accessibilityHint, accessibilityValue, background, buttonStyle, contentShape, font, foregroundStyle, frame, lineLimit, multilineTextAlignment, shapes, textFieldStyle, tint } from '@expo/ui/swift-ui/modifiers';
import { Badge, Card, EmptyState, Field, GlassIconButton, ListRow, NativeSwitch, PageHeader, PrimaryButton, Screen, SectionTitle, Segmented } from '../components/PrototypeUI';
import { useAppTheme } from '../theme';
import { usePrototypeStore } from '../store/prototypeStore';
import type { RootStackParamList, SettingsSection } from '../navigation';
import { apiRequest, mobileApi } from '../../../api/client';
import { useSessionStore } from '../../../store/session';
import { useRealtimeStore } from '../../../providers/realtimeStore';
import { canUseNativePasskeys, createPkceRequest, nativeRegister, openPasskeyEnrollment, PasskeyCancelledError } from '../../../auth/passkeys';

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

function NativeDestinationRow({ icon, title, detail, onPress }: { icon: string; title: string; detail?: string; onPress: () => void }) {
  return <SwiftUIButton onPress={onPress} modifiers={[buttonStyle('plain'), foregroundStyle('primary')]}><SwiftUIHStack spacing={12} modifiers={[contentShape(shapes.rectangle())]}><SwiftUIImage systemName={icon as never} size={17} modifiers={[frame({ width: 22, height: 22 })]} /><SwiftUIText>{title}</SwiftUIText><SwiftUISpacer />{detail ? <SwiftUIText modifiers={[foregroundStyle('secondary'), font({ textStyle: 'footnote' })]}>{detail}</SwiftUIText> : null}<SwiftUIImage systemName="chevron.right" size={11} modifiers={[foregroundStyle('secondary')]} /></SwiftUIHStack></SwiftUIButton>;
}

export function AccountScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Account'>) {
  const theme = useAppTheme();
  const session = usePrototypeStore((state) => state.session);
  const instance = usePrototypeStore((state) => state.instance);
  const signOut = useSessionStore((state) => state.logout);
  const twoFactorSupported = useSessionStore((state) => state.config?.capabilities.twoFactorAuth ?? false);
  const passkeysSupported = useSessionStore((state) => state.config?.capabilities.passkeys ?? false);
  const user = session.user;
  const confirmSignOut = () => Alert.alert('Sign out?', 'End this session on this device.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: signOut }]);

  if (Platform.OS === 'ios') return <SwiftUIHost modifiers={[tint(theme.blue)]} style={styles.flex}><SwiftUIForm>
    <SwiftUISection title="Profile">
      <SwiftUILabeledContent label="Name"><SwiftUIText>{user?.name ?? 'Pulpo Member'}</SwiftUIText></SwiftUILabeledContent>
      <SwiftUILabeledContent label="Email"><SwiftUIText modifiers={[foregroundStyle('secondary')]}>{user?.email ?? ''}</SwiftUIText></SwiftUILabeledContent>
      <SwiftUILabeledContent label="Role"><SwiftUIText modifiers={[foregroundStyle('secondary')]}>Member</SwiftUIText></SwiftUILabeledContent>
      <NativeDestinationRow icon="person.crop.circle" title="Edit Profile" onPress={() => navigation.navigate('EditProfile')} />
    </SwiftUISection>
    <SwiftUISection title="Security"><NativeDestinationRow icon="lock.rotation" title="Change Password" onPress={() => navigation.navigate('ChangePassword')} />{passkeysSupported ? <NativeDestinationRow icon="person.badge.key" title="Passkeys" onPress={() => navigation.navigate('Passkeys')} /> : null}{twoFactorSupported ? <NativeDestinationRow icon="checkmark.shield" title="Two-Factor Authentication" onPress={() => navigation.navigate('TwoFactor')} /> : null}</SwiftUISection>
    <SwiftUISection title="Server"><NativeDestinationRow icon="network" title="Pulpo Instance" detail={instance.version} onPress={() => navigation.navigate('InstanceDetails')} /></SwiftUISection>
    <SwiftUISection title="Session"><SwiftUIButton label="Sign Out" role="destructive" systemImage="rectangle.portrait.and.arrow.right" onPress={confirmSignOut} /></SwiftUISection>
  </SwiftUIForm></SwiftUIHost>;

  return <Screen><PageHeader title="Account" onBack={() => navigation.goBack()} /><SectionTitle>Profile</SectionTitle><Card><ListRow title="Name" value={user?.name ?? 'Pulpo Member'} /><ListRow title="Email" value={user?.email ?? ''} /><ListRow title="Role" value="Member" /><ListRow icon="person.crop.circle" title="Edit profile" last onPress={() => navigation.navigate('EditProfile')} /></Card><SectionTitle>Security</SectionTitle><Card><ListRow icon="lock.rotation" title="Change password" last={!passkeysSupported && !twoFactorSupported} onPress={() => navigation.navigate('ChangePassword')} />{passkeysSupported ? <ListRow icon="person.badge.key" title="Passkeys" last={!twoFactorSupported} onPress={() => navigation.navigate('Passkeys')} /> : null}{twoFactorSupported ? <ListRow icon="checkmark.shield" title="Two-factor authentication" last onPress={() => navigation.navigate('TwoFactor')} /> : null}</Card><SectionTitle>Server</SectionTitle><Card><ListRow icon="network" title="Pulpo instance" value={instance.version} last onPress={() => navigation.navigate('InstanceDetails')} /></Card><SectionTitle>Session</SectionTitle><Card><ListRow icon="rectangle.portrait.and.arrow.right" iconColor={theme.red} title="Sign out" destructive last onPress={confirmSignOut} /></Card></Screen>;
}

type PasskeyAction = 'list' | 'add' | 'rename' | 'delete';

export function PasskeysScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Passkeys'>) {
  const theme = useAppTheme();
  const instanceUrl = useSessionStore((state) => state.instanceUrl);
  const [data, setData] = useState<PasskeyList | null>(null);
  const [action, setAction] = useState<PasskeyAction>('list');
  const [selected, setSelected] = useState<PasskeySummary | null>(null);
  const [name, setName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [forceSafari, setForceSafari] = useState(false);
  const refresh = useCallback(() => mobileApi.passkeys().then(setData).catch((next) => setError(next instanceof Error ? next.message : 'Could not load passkeys.')), []);
  useEffect(() => { void refresh(); }, [refresh]);
  const reset = () => { setAction('list'); setSelected(null); setName(''); setCurrentPassword(''); setVerificationCode(''); setError(''); setForceSafari(false); };
  const fail = (next: unknown, fallback: string) => {
    if (next instanceof PasskeyCancelledError) return;
    setError(next instanceof Error ? next.message : fallback);
  };
  const registerInSafari = async () => {
    const { state } = await createPkceRequest();
    const { url } = await mobileApi.beginBrowserPasskeyRegistration(name.trim(), currentPassword, state, data?.requiresSecondFactor ? verificationCode : undefined);
    await openPasskeyEnrollment(url, state, instanceUrl);
  };
  const add = () => {
    setLoading(true); setError('');
    const execute = async () => {
      if (forceSafari || !canUseNativePasskeys(instanceUrl)) {
        await registerInSafari();
      } else {
        const ceremony = await mobileApi.beginPasskeyRegistration(name.trim(), currentPassword, data?.requiresSecondFactor ? verificationCode : undefined);
        let response;
        try {
          response = await nativeRegister(ceremony);
        } catch (next) {
          if (next instanceof PasskeyCancelledError) throw next;
          setForceSafari(true);
          setVerificationCode('');
          setError(`Native passkeys are not configured for this domain. ${data?.requiresSecondFactor ? 'Enter a fresh authenticator or recovery code, then continue securely in Safari.' : 'Continue securely in Safari.'}`);
          return;
        }
        await mobileApi.verifyPasskeyRegistration(ceremony.ceremonyToken, response);
      }
      reset();
      await refresh();
    };
    void execute().catch((next) => fail(next, 'Could not add passkey.')).finally(() => setLoading(false));
  };
  const rename = () => {
    if (!selected) return;
    setLoading(true); setError('');
    void mobileApi.renamePasskey(selected.id, name.trim()).then(() => { reset(); return refresh(); }).catch((next) => fail(next, 'Could not rename passkey.')).finally(() => setLoading(false));
  };
  const remove = () => {
    if (!selected) return;
    setLoading(true); setError('');
    void mobileApi.deletePasskey(selected.id, currentPassword, data?.requiresSecondFactor ? verificationCode : undefined).then(() => { reset(); return refresh(); }).catch((next) => fail(next, 'Could not delete passkey.')).finally(() => setLoading(false));
  };
  const sensitiveReady = Boolean(currentPassword && (!data?.requiresSecondFactor || verificationCode.length >= 6));
  const choose = (nextAction: PasskeyAction, passkey?: PasskeySummary) => { setAction(nextAction); setSelected(passkey ?? null); setName(passkey?.name ?? ''); setCurrentPassword(''); setVerificationCode(''); setError(''); setForceSafari(false); };

  return <Screen><PageHeader title="Passkeys" subtitle="Sign in without a password or authenticator code." onBack={() => action === 'list' ? navigation.goBack() : reset()} />
    {action === 'list' && <>
      <SectionTitle>{data ? `${data.passkeys.length} of 10 passkeys` : 'Passkeys'}</SectionTitle>
      {!data ? <Text style={[styles.twoFactorHelp, { color: theme.secondary }]}>Loading…</Text> : data.passkeys.length === 0 ? <EmptyState icon="person.badge.key" title="No passkeys yet" detail="Add one to use Face ID, Touch ID, a device PIN, or a security key to sign in." /> : <Card>{data.passkeys.map((passkey, index) => <ListRow key={passkey.id} icon="person.badge.key" title={passkey.name} detail={`Added ${new Date(passkey.createdAt).toLocaleDateString()} · ${passkey.lastUsedAt ? `last used ${new Date(passkey.lastUsedAt).toLocaleDateString()}` : 'never used'}`} last={index === data.passkeys.length - 1} onPress={() => Alert.alert(passkey.name, undefined, [{ text: 'Rename', onPress: () => choose('rename', passkey) }, { text: 'Delete', style: 'destructive', onPress: () => choose('delete', passkey) }, { text: 'Cancel', style: 'cancel' }])} />)}</Card>}
      {error ? <Text accessibilityRole="alert" style={[styles.twoFactorError, { color: theme.red }]}>{error}</Text> : null}
      <PrimaryButton label="Add passkey" icon="plus" disabled={!data || data.passkeys.length >= 10} onPress={() => choose('add')} />
    </>}
    {action === 'rename' && <><SectionTitle>Rename passkey</SectionTitle><Field label="Passkey name" maxLength={80} value={name} onChangeText={setName} />{error ? <Text accessibilityRole="alert" style={[styles.twoFactorError, { color: theme.red }]}>{error}</Text> : null}<PrimaryButton label="Save name" loading={loading} disabled={!name.trim()} onPress={rename} /></>}
    {(action === 'add' || action === 'delete') && <><SectionTitle>{action === 'add' ? 'Add a passkey' : `Delete ${selected?.name ?? 'passkey'}`}</SectionTitle>{action === 'add' ? <Field label="Passkey name" maxLength={80} value={name} onChangeText={setName} /> : <Text style={[styles.twoFactorHelp, { color: theme.secondary }]}>You can still sign in with your password or another passkey.</Text>}<Field label="Current password" secureTextEntry autoComplete="current-password" value={currentPassword} onChangeText={setCurrentPassword} />{data?.requiresSecondFactor ? <Field label="Authenticator or recovery code" autoComplete="one-time-code" autoCapitalize="characters" value={verificationCode} onChangeText={(value) => setVerificationCode(value.toUpperCase())} /> : null}<Text style={[styles.helper, { color: theme.secondary }]}>This security change signs out your other devices. This iPhone stays signed in.</Text>{error ? <Text accessibilityRole="alert" style={[styles.twoFactorError, { color: theme.red }]}>{error}</Text> : null}<PrimaryButton label={action === 'add' ? forceSafari ? 'Continue in Safari' : 'Add passkey' : 'Delete passkey'} variant={action === 'delete' ? 'destructive' : 'primary'} loading={loading} disabled={!sensitiveReady || (action === 'add' && !name.trim())} onPress={action === 'add' ? add : remove} /></>}
  </Screen>;
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

  if (Platform.OS === 'ios') return <SwiftUIHost modifiers={[tint(theme.blue)]} style={styles.flex}><SwiftUIForm><SwiftUISection title="Profile" footer={<SwiftUIText modifiers={[foregroundStyle('secondary')]}>This is the name shown on your Pulpo account.</SwiftUIText>}><NativeFormTextField title="Name" value={name} onChange={setName} /><SwiftUILabeledContent label="Email"><SwiftUIText modifiers={[foregroundStyle('secondary')]}>{session.user?.email ?? ''}</SwiftUIText></SwiftUILabeledContent></SwiftUISection></SwiftUIForm></SwiftUIHost>;
  return <Screen><PageHeader title="Edit Profile" onBack={() => navigation.goBack()} /><Field label="Display name" value={name} onChangeText={setName} /><PrimaryButton label="Save" onPress={save} /></Screen>;
}

function NativePasswordField({ placeholder, value, onChange }: { placeholder: string; value: string; onChange: (value: string) => void }) {
  const theme = useAppTheme();
  const nativeText = useNativeState(value);
  useEffect(() => { if (nativeText.get() !== value) nativeText.set(value); }, [nativeText, value]);
  return <SwiftUISecureField text={nativeText} onTextChange={onChange}>
    <SwiftUISecureField.Placeholder><SwiftUIText modifiers={[foregroundStyle(theme.secondary)]}>{placeholder}</SwiftUIText></SwiftUISecureField.Placeholder>
  </SwiftUISecureField>;
}

export function ChangePasswordScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'ChangePassword'>) {
  const theme = useAppTheme();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const valid = Boolean(current && next.length >= 8 && next === confirmation);
  const buttonBackground = valid ? theme.blue : theme.disabledBackground;
  const buttonForeground = valid ? theme.accentText : theme.disabledText;
  const submit = () => {
    if (!valid) return;
    void mobileApi.changePassword(current, next).then(() => Alert.alert('Password updated', 'Your other sessions remain signed in.', [{ text: 'Done', onPress: () => navigation.goBack() }])).catch((error) => Alert.alert('Couldn’t update password', error instanceof Error ? error.message : undefined));
  };

  if (Platform.OS === 'ios') return <SwiftUIHost modifiers={[tint(theme.blue)]} style={styles.flex}><SwiftUIForm><SwiftUISection title="Password" footer={<SwiftUIText modifiers={[foregroundStyle('secondary')]}>Use at least 8 characters. Other signed-in devices will remain active.</SwiftUIText>}><NativePasswordField placeholder="Current password" value={current} onChange={setCurrent} /><NativePasswordField placeholder="New password" value={next} onChange={setNext} /><NativePasswordField placeholder="Confirm new password" value={confirmation} onChange={setConfirmation} /></SwiftUISection><SwiftUISection><SwiftUIButton onPress={valid ? submit : undefined} modifiers={[buttonStyle('plain'), frame({ maxWidth: Infinity, minHeight: 44 }), background(buttonBackground, shapes.capsule()), contentShape(shapes.capsule()), accessibilityValue(valid ? 'Enabled' : 'Disabled'), accessibilityHint(valid ? 'Updates your password' : 'Enter your current password and matching new passwords to enable')]}><SwiftUIText modifiers={[foregroundStyle(buttonForeground), font({ textStyle: 'body', weight: 'semibold' })]}>Update Password</SwiftUIText></SwiftUIButton></SwiftUISection></SwiftUIForm></SwiftUIHost>;
  return <Screen><PageHeader title="Change Password" onBack={() => navigation.goBack()} /><Field label="Current password" secureTextEntry value={current} onChangeText={setCurrent} /><Field label="New password" secureTextEntry value={next} onChangeText={setNext} /><Field label="Confirm new password" secureTextEntry value={confirmation} onChangeText={setConfirmation} /><PrimaryButton label="Update password" disabled={!valid} onPress={submit} /></Screen>;
}

type TwoFactorAction = 'idle' | 'setup' | 'enroll' | 'recovery' | 'regenerate' | 'disable';

export function TwoFactorScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'TwoFactor'>) {
  const theme = useAppTheme();
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [action, setAction] = useState<TwoFactorAction>('idle');
  const [enrollment, setEnrollment] = useState<TwoFactorEnrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const refresh = useCallback(() => mobileApi.twoFactorStatus().then(setStatus).catch((next) => setError(next instanceof Error ? next.message : 'Could not load two-factor status.')), []);
  useEffect(() => { void refresh(); }, [refresh]);
  const reset = () => { setAction('idle'); setEnrollment(null); setRecoveryCodes([]); setCurrentPassword(''); setVerificationCode(''); setConfirmationCode(''); setError(''); };
  const fail = (next: unknown) => setError(next instanceof Error ? next.message : 'Could not update two-factor authentication.');
  const begin = () => {
    setLoading(true); setError('');
    void mobileApi.beginTwoFactorEnrollment(currentPassword, status?.enabled ? verificationCode : undefined)
      .then((value) => { setEnrollment(value); setVerificationCode(''); setAction('enroll'); })
      .catch(fail).finally(() => setLoading(false));
  };
  const confirm = () => {
    setLoading(true); setError('');
    void mobileApi.confirmTwoFactorEnrollment(confirmationCode)
      .then((value) => { setRecoveryCodes(value.recoveryCodes); setEnrollment(null); setAction('recovery'); return refresh(); })
      .catch(fail).finally(() => setLoading(false));
  };
  const change = () => {
    setLoading(true); setError('');
    const request = action === 'regenerate'
      ? mobileApi.regenerateTwoFactorRecoveryCodes(currentPassword, verificationCode).then((value) => { setRecoveryCodes(value.recoveryCodes); setAction('recovery'); })
      : mobileApi.disableTwoFactor(currentPassword, verificationCode).then(reset);
    void request.then(refresh).catch(fail).finally(() => setLoading(false));
  };
  const copyCodes = () => { void Clipboard.setStringAsync(recoveryCodes.join('\n')).then(() => Alert.alert('Copied', 'Store the recovery codes somewhere secure.')); };

  return <Screen><PageHeader title="Two-Factor Authentication" onBack={() => action === 'idle' ? navigation.goBack() : reset()} />
    {action === 'idle' && <><SectionTitle>Status</SectionTitle><Card><ListRow icon={status?.enabled ? 'checkmark.shield.fill' : 'shield'} title={status?.enabled ? 'Enabled' : status ? 'Not enabled' : 'Loading…'} detail={status?.enabled ? `${status.recoveryCodesRemaining} recovery codes remaining` : 'Use an authenticator app for six-digit sign-in codes.'} last /></Card><SectionTitle>Security</SectionTitle><Card><ListRow icon="qrcode" title={status?.enabled ? 'Replace authenticator app' : 'Set up authenticator app'} onPress={() => setAction('setup')} last={!status?.enabled} />{status?.enabled ? <><ListRow icon="arrow.clockwise" title="Generate new recovery codes" onPress={() => setAction('regenerate')} /><ListRow icon="shield.slash" iconColor={theme.red} title="Disable two-factor authentication" destructive last onPress={() => setAction('disable')} /></> : null}</Card>{error ? <Text style={[styles.twoFactorError, { color: theme.red }]}>{error}</Text> : null}</>}
    {(action === 'setup' || action === 'regenerate' || action === 'disable') && <><SectionTitle>Confirm security change</SectionTitle><Field label="Current password" secureTextEntry autoComplete="current-password" value={currentPassword} onChangeText={setCurrentPassword} />{status?.enabled ? <Field label="Authenticator or recovery code" autoCapitalize="characters" autoComplete="one-time-code" value={verificationCode} onChangeText={(value) => setVerificationCode(value.toUpperCase())} /> : null}{error ? <Text style={[styles.twoFactorError, { color: theme.red }]}>{error}</Text> : null}<PrimaryButton label={action === 'disable' ? 'Disable two-factor authentication' : action === 'regenerate' ? 'Generate recovery codes' : 'Continue'} variant={action === 'disable' ? 'destructive' : 'primary'} loading={loading} disabled={!currentPassword || (Boolean(status?.enabled) && verificationCode.length < 6)} onPress={action === 'setup' ? begin : change} /></>}
    {action === 'enroll' && enrollment && <><Text style={[styles.twoFactorHelp, { color: theme.secondary }]}>Scan this QR code in your authenticator app, or copy the manual key.</Text><Image source={{ uri: enrollment.qrCodeDataUrl }} accessibilityLabel="Authenticator enrollment QR code" style={styles.twoFactorQr} /><Card style={styles.twoFactorKey}><Text selectable style={[styles.twoFactorKeyText, { color: theme.text }]}>{enrollment.manualKey}</Text><PrimaryButton label="Copy manual key" variant="secondary" icon="doc.on.doc" onPress={() => { void Clipboard.setStringAsync(enrollment.manualKey); }} /></Card><Field label="Six-digit authenticator code" autoComplete="one-time-code" keyboardType="number-pad" maxLength={6} value={confirmationCode} onChangeText={(value) => setConfirmationCode(value.replace(/\D/g, '').slice(0, 6))} />{error ? <Text style={[styles.twoFactorError, { color: theme.red }]}>{error}</Text> : null}<PrimaryButton label="Confirm and enable" loading={loading} disabled={confirmationCode.length !== 6} onPress={confirm} /></>}
    {action === 'recovery' && <><Text style={[styles.twoFactorHelp, { color: theme.secondary }]}>Save these codes now. Each can be used once and they will not be shown again.</Text><Card style={styles.twoFactorCodes}>{recoveryCodes.map((code) => <Text key={code} selectable style={[styles.twoFactorCode, { color: theme.text }]}>{code}</Text>)}</Card><PrimaryButton label="Copy recovery codes" variant="secondary" icon="doc.on.doc" onPress={copyCodes} /><PrimaryButton label="Done" onPress={reset} /></>}
  </Screen>;
}

export function InstanceDetailsScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'InstanceDetails'>) {
  const theme = useAppTheme();
  const instance = usePrototypeStore((state) => state.instance);
  const realtimeConnectionPhase = useRealtimeStore((state) => state.connectionPhase);
  const networkState = Network.useNetworkState();
  const connectionLabel = networkState.isConnected === false || networkState.isInternetReachable === false
    ? 'Offline'
    : realtimeConnectionPhase === 'connected' ? 'Connected'
      : realtimeConnectionPhase === 'reconnecting' ? 'Reconnecting' : 'Connecting';
  if (Platform.OS === 'ios') return <SwiftUIHost modifiers={[tint(theme.blue)]} style={styles.flex}><SwiftUIForm><SwiftUISection title="Connection"><SwiftUILabeledContent label="Status"><SwiftUIText>{connectionLabel}</SwiftUIText></SwiftUILabeledContent><SwiftUILabeledContent label="Name"><SwiftUIText>{instance.name}</SwiftUIText></SwiftUILabeledContent><SwiftUILabeledContent label="Version"><SwiftUIText>{instance.version}</SwiftUIText></SwiftUILabeledContent></SwiftUISection><SwiftUISection title="Endpoints"><SwiftUILabeledContent label="Server"><SwiftUIText modifiers={[foregroundStyle('secondary'), font({ textStyle: 'footnote' })]}>{instance.url}</SwiftUIText></SwiftUILabeledContent><SwiftUILabeledContent label="API"><SwiftUIText modifiers={[foregroundStyle('secondary'), font({ textStyle: 'footnote' })]}>{`${instance.url}/v1`}</SwiftUIText></SwiftUILabeledContent></SwiftUISection></SwiftUIForm></SwiftUIHost>;
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
  if (Platform.OS === 'ios') return <SwiftUIHost modifiers={[tint(theme.blue)]} style={styles.flex}><SwiftUIForm><SwiftUISection><SwiftUIButton modifiers={[buttonStyle('plain'), foregroundStyle('primary')]} onPress={() => navigation.navigate('Account')}><SwiftUIHStack spacing={12} modifiers={[contentShape(shapes.rectangle())]}><SwiftUIImage systemName="person.crop.circle.fill" size={42} /><SwiftUIVStack alignment="leading" spacing={2}><SwiftUIText modifiers={[font({ textStyle: 'headline' })]}>{session.user?.name ?? 'Pulpo Member'}</SwiftUIText><SwiftUIText modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary')]}>{session.user?.email ?? ''} · Member</SwiftUIText></SwiftUIVStack><SwiftUISpacer /><SwiftUIImage systemName="chevron.right" size={11} color={theme.tertiary} /></SwiftUIHStack></SwiftUIButton></SwiftUISection><SwiftUISection title="Member settings">{settingsSections.slice(0, 2).map((section) => <NativeSettingsLink key={section.id} icon={section.icon} title={section.title} detail={section.detail} onPress={() => open(section.id)} />)}</SwiftUISection><SwiftUISection title="Data and support">{settingsSections.slice(2).map((section) => <NativeSettingsLink key={section.id} icon={section.icon} title={section.title} detail={section.detail} onPress={() => open(section.id)} />)}</SwiftUISection></SwiftUIForm></SwiftUIHost>;
  return <Screen><PageHeader title="Settings" subtitle={new URL(instance.url).hostname} onBack={() => navigation.goBack()} />
    <Card style={styles.profileCard}><View style={[styles.profileAvatar, { backgroundColor: theme.text }]}><Text style={[styles.profileInitials, { color: theme.background }]}>{session.user?.initials ?? '?'}</Text></View><View style={styles.flex}><Text style={[styles.profileName, { color: theme.text }]}>{session.user?.name ?? 'Pulpo Member'}</Text><Text style={[styles.profileEmail, { color: theme.secondary }]}>{session.user?.email}</Text></View><Badge label="Member" color={theme.green} /></Card>
    <SectionTitle>Member settings</SectionTitle><Card>{settingsSections.slice(0, 2).map((section, index) => <ListRow key={section.id} icon={section.icon} title={section.title} detail={section.detail} last={index === 1} onPress={() => open(section.id)} />)}</Card>
    <SectionTitle>Data and support</SectionTitle><Card>{settingsSections.slice(2).map((section, index, list) => <ListRow key={section.id} icon={section.icon} title={section.title} detail={section.detail} last={index === list.length - 1} onPress={() => open(section.id)} />)}</Card>
  </Screen>;
}

function NativeSettingsLink({ icon, title, detail, onPress }: { icon: string; title: string; detail: string; onPress: () => void }) {
  return <SwiftUIButton modifiers={[buttonStyle('plain'), foregroundStyle('primary')]} onPress={onPress}><SwiftUIHStack spacing={12} modifiers={[contentShape(shapes.rectangle())]}><SwiftUIImage systemName={icon as never} size={17} modifiers={[frame({ width: 22, height: 22 })]} /><SwiftUIVStack alignment="leading" spacing={2}><SwiftUIText modifiers={[font({ textStyle: 'subheadline', weight: 'medium' }), lineLimit(1)]}>{title}</SwiftUIText><SwiftUIText modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary'), lineLimit(1)]}>{detail}</SwiftUIText></SwiftUIVStack><SwiftUISpacer /><SwiftUIImage systemName="chevron.right" size={11} /></SwiftUIHStack></SwiftUIButton>;
}

const settingTitles: Record<SettingsSection, string> = { general: 'General', interface: 'Interface', data: 'Data Controls' };

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
    queryFn: () => apiRequest<{ usedBytes: number; limitBytes: number; remainingBytes: number }>('/api/attachments/usage'),
    enabled: section === 'data' && Boolean(userId),
  });
  const storageUsed = storage.data?.usedBytes ?? 0;
  const storageProgress = storage.data?.limitBytes ? Math.min(1, storageUsed / storage.data.limitBytes) : 0;
  const storageLabel = storage.data
    ? `${formatBytes(storageUsed)} of ${formatBytes(storage.data.limitBytes)}`
    : storage.isError || !userId
      ? 'Unavailable'
      : 'Loading…';
  useLayoutEffect(() => {
    if (Platform.OS === 'ios') navigation.setOptions({ title: settingTitles[section] });
  }, [navigation, section]);
  if (Platform.OS === 'ios') return <SwiftUIHost key={section === 'data' ? storageLabel : section} modifiers={[tint(theme.blue)]} style={styles.flex}><SwiftUIForm>
    {section === 'general' && <>
      <SwiftUISection title="Appearance">
        <NativeChoiceRow icon="circle.lefthalf.filled" title="Theme" value={preferences.theme} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] as const} onChange={(value) => setPreference('theme', value)} />
      </SwiftUISection>
    </>}
    {section === 'interface' && <>
      <SwiftUISection title="Conversation">
        <NativeToggleRow icon="brain.head.profile" title="Show reasoning" detail="Show expandable work details." value={preferences.showReasoning} onChange={(value) => setPreference('showReasoning', value)} />
        <NativeToggleRow icon="iphone.radiowaves.left.and.right" title="Haptics" detail="Feedback for sends, menus, and completion." value={preferences.haptics} onChange={(value) => setPreference('haptics', value)} />
      </SwiftUISection>
      <SwiftUISection title="Offline storage">
        <SwiftUILabeledContent label="Chats kept on device"><SwiftUIText modifiers={[foregroundStyle('secondary')]}>{`${preferences.localChatLimit}`}</SwiftUIText></SwiftUILabeledContent>
        <SwiftUILabeledContent label="Attachment cache"><SwiftUIText modifiers={[foregroundStyle('secondary')]}>{`${preferences.attachmentCacheMb} MB`}</SwiftUIText></SwiftUILabeledContent>
      </SwiftUISection>
    </>}
    {section === 'data' && <>
      <SwiftUISection title="Memories">
        <NativeToggleRow icon="brain.head.profile" title="Memories" detail="Use your MEMORY.md profile and recall relevant context from eligible chats." value={preferences.memoryEnabled} onChange={(value) => setPreference('memoryEnabled', value)} />
      </SwiftUISection>
      <SwiftUISection title="Chat expiration" footer={<SwiftUIText modifiers={[foregroundStyle('secondary')]}>Move chats to Trash automatically unless saved within the selected period.</SwiftUIText>}>
        <NativeChoiceRow
          icon="hourglass"
          title="Automatic expiration"
          value={preferences.automaticChatExpiration}
          options={[{ value: 'disabled', label: 'Disabled' }, { value: '24h', label: '24 hours' }, { value: '7d', label: '7 days' }] as const}
          onChange={(value) => setPreference('automaticChatExpiration', value)}
        />
      </SwiftUISection>
      <SwiftUISection title="File storage" footer={<SwiftUIText modifiers={[foregroundStyle('secondary')]}>Uploaded files and model-created files count toward this allowance.</SwiftUIText>}>
        <SwiftUILabeledContent label="Storage used"><SwiftUIText>{storageLabel}</SwiftUIText></SwiftUILabeledContent>
        <SwiftUIProgressView value={storageProgress} />
      </SwiftUISection>
      <SwiftUISection title="Danger zone"><SwiftUIButton label="Trash all chats" role="destructive" systemImage="trash" onPress={() => Alert.alert('Trash all chats?', 'Chats remain recoverable according to your trash retention setting.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Trash all', style: 'destructive', onPress: trashAllChats }])} /></SwiftUISection>
    </>}
  </SwiftUIForm></SwiftUIHost>;
  return <Screen><PageHeader title={settingTitles[section]} onBack={() => navigation.goBack()} />
    {section === 'general' && <><SectionTitle>Appearance</SectionTitle><Card><ListRow title="Theme" detail="Applies across the whole app."><View style={{ width: 178 }}><Segmented options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] as const} value={preferences.theme} onChange={(value) => setPreference('theme', value)} /></View></ListRow></Card></>}
    {section === 'interface' && <><SectionTitle>Conversation</SectionTitle><Card><Toggle title="Show reasoning" detail="Show expandable work details." value={preferences.showReasoning} onChange={(value) => setPreference('showReasoning', value)} /><Toggle title="Haptics" detail="Feedback for sends, menus, and completion." value={preferences.haptics} onChange={(value) => setPreference('haptics', value)} last /></Card><SectionTitle>Offline storage</SectionTitle><Card><ListRow title="Chats kept on device" detail="Recent chats remain instantly available." value={`${preferences.localChatLimit}`} /><ListRow title="Attachment cache" detail="Maximum local file data." value={`${preferences.attachmentCacheMb} MB`} last /></Card></>}
    {section === 'data' && <><SectionTitle>Memories</SectionTitle><Card><Toggle title="Memories" detail="Use your MEMORY.md profile and recall relevant context from eligible chats." value={preferences.memoryEnabled} onChange={(value) => setPreference('memoryEnabled', value)} last /></Card><SectionTitle>Chat expiration</SectionTitle><Card><ListRow icon="hourglass" iconColor={theme.green} title="Automatic expiration" detail="Move chats to Trash automatically unless saved within the selected period." value={preferences.automaticChatExpiration === 'disabled' ? 'Disabled' : preferences.automaticChatExpiration} last onPress={() => Alert.alert('Automatic chat expiration', undefined, [{ text: 'Disabled', onPress: () => setPreference('automaticChatExpiration', 'disabled') }, { text: '24 hours', onPress: () => setPreference('automaticChatExpiration', '24h') }, { text: '7 days', onPress: () => setPreference('automaticChatExpiration', '7d') }, { text: 'Cancel', style: 'cancel' }])} /></Card><SectionTitle>File storage</SectionTitle><Card style={styles.storage}><View style={styles.storageLine}><Text style={[styles.storageTitle, { color: theme.text }]}>{storageLabel}</Text><Text style={[styles.storagePercent, { color: theme.secondary }]}>{`${Math.round(storageProgress * 100)}%`}</Text></View><View style={[styles.storageTrack, { backgroundColor: theme.fillStrong }]}><View style={[styles.storageBar, { backgroundColor: theme.blue, width: `${storageProgress * 100}%` }]} /></View><Text style={[styles.helper, { color: theme.secondary }]}>Uploaded files and model-created files count toward this allowance.</Text></Card><SectionTitle>Danger zone</SectionTitle><Card><ListRow icon="trash" iconColor={theme.red} title="Trash all chats" detail={`${chats.filter((chat) => chat.deletedAt === null).length} active chats`} destructive last onPress={() => Alert.alert('Trash all chats?', 'Chats remain recoverable according to your trash retention setting.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Trash all', style: 'destructive', onPress: trashAllChats }])} /></Card></>}
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
  if (Platform.OS === 'ios') return <SwiftUIHost modifiers={[tint(theme.blue)]} style={styles.flex}><SwiftUIForm>
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

const styles = StyleSheet.create({
  flex: { flex: 1 }, helper: { fontSize: 12, lineHeight: 18 },
  profileCard: { flexDirection: 'row', alignItems: 'center', padding: 15, gap: 12 }, profileAvatar: { width: 48, height: 48, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }, profileInitials: { fontSize: 15, fontWeight: '900' }, profileName: { fontSize: 16, fontWeight: '700' }, profileEmail: { fontSize: 12, marginTop: 3 }, storage: { padding: 15 }, storageLine: { flexDirection: 'row', justifyContent: 'space-between' }, storageTitle: { fontSize: 14, fontWeight: '700' }, storagePercent: { fontSize: 12 }, storageTrack: { height: 8, borderRadius: 4, overflow: 'hidden', marginVertical: 11 }, storageBar: { height: 8, borderRadius: 4 },
  twoFactorHelp: { fontSize: 14, lineHeight: 20, marginVertical: 12 }, twoFactorError: { fontSize: 13, lineHeight: 18, marginVertical: 8 }, twoFactorQr: { width: 240, height: 240, alignSelf: 'center', borderRadius: 16, backgroundColor: '#ffffff', marginBottom: 16 }, twoFactorKey: { padding: 14, gap: 12, marginBottom: 16 }, twoFactorKeyText: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 13, textAlign: 'center' }, twoFactorCodes: { padding: 18, flexDirection: 'row', flexWrap: 'wrap', marginVertical: 14 }, twoFactorCode: { width: '50%', fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 14, lineHeight: 28, textAlign: 'center' },
});
