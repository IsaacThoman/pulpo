import { MaterialButton, MaterialField } from '../../../platform/MaterialUI';
import { useSubpageBack } from '../../../platform/useSubpageBack';
import { DeleteAccountAction } from '../../../components/DeleteAccount';
import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import { useRef, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from '../../../platform/SymbolView';
import { useAppTheme } from '../theme';
import { normalizeInstanceUrl } from '../domain';
import { mobileApi } from '../../../api/client';
import { NativePasskeyError, PasskeyCancelledError } from '../../../auth/passkeys';
import { useSessionStore } from '../../../store/session';
import { FORM_CONTENT_MAX } from '../../../responsive';

type AuthPage = 'login' | 'login-options' | 'two-factor' | 'signup' | 'forgot' | 'instance';

const mockupOneDark = {
  background: '#101014', surface: '#18181C', border: '#303036', text: '#FAFAFA',
  textMuted: '#A1A1AA', textFaint: '#98989D', accent: '#F4F4F5', accentText: '#18181B', destructive: '#FF453A',
};

const mockupOneLight = {
  background: '#FFFFFF', surface: '#F8F8FA', border: '#E2E2E7', text: '#18181B',
  textMuted: '#64646D', textFaint: '#6E6E73', accent: '#18181B', accentText: '#FFFFFF', destructive: '#C5221F',
};

type AuthColors = Record<keyof typeof mockupOneDark, string>;
type AuthFieldProps = ComponentProps<typeof TextInput> & {
  colors: AuthColors;
  icon: Parameters<typeof SymbolView>[0]['name'];
  invalid?: boolean;
  label: string;
};

const COMPACT_AUTH_HEIGHT = 700;
const INVITE_CODE_LENGTH = 6;
const DEFAULT_PENDING_MESSAGE = 'Your account is pending approval. An admin will review it shortly.';

type PendingAction = 'redeem' | 'refresh' | 'signout';

function cleanInviteCode(value: string) {
  return value.toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function insertedText(previous: string, raw: string) {
  // Pastes at the end or start are unambiguous; otherwise diff against the previous value.
  if (raw.startsWith(previous)) return raw.slice(previous.length);
  if (raw.endsWith(previous)) return raw.slice(0, raw.length - previous.length);
  let start = 0;
  while (start < previous.length && raw[start] === previous[start]) start += 1;
  let end = 0;
  while (end < previous.length - start && raw[raw.length - 1 - end] === previous[previous.length - 1 - end]) end += 1;
  return raw.slice(start, raw.length - end);
}

function nextInviteCode(previous: string, raw: string) {
  const cleaned = cleanInviteCode(raw);
  if (cleaned.length <= INVITE_CODE_LENGTH) return cleaned;
  // A full code pasted into an existing one replaces it instead of being cut off.
  const inserted = cleanInviteCode(insertedText(previous, raw));
  return (inserted.length === INVITE_CODE_LENGTH ? inserted : cleaned).slice(0, INVITE_CODE_LENGTH);
}

function useCompactAuthLayout() {
  return useWindowDimensions().height <= COMPACT_AUTH_HEIGHT;
}

function AuthShell({ title, subtitle, children, footer, colors }: PropsWithChildren<{ title: string; subtitle: string; footer?: ReactNode; colors: AuthColors }>) {
  const insets = useSafeAreaInsets();
  const compact = useCompactAuthLayout();
  return <KeyboardAvoidingView behavior={Platform.OS === 'android' ? 'padding' : undefined} style={[styles.root, { backgroundColor: colors.background }]}>
    <ScrollView alwaysBounceVertical={false} automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, compact && styles.compactContent, { paddingTop: insets.top + (compact ? 14 : 42), paddingBottom: insets.bottom + (compact ? 8 : 24) }]}>
      <View style={[styles.brand, compact && styles.compactBrand]}>
        <Image source={require('../../assets/pulpo-smiley.png')} style={[styles.logo, compact && styles.compactLogo]} />
        <Text style={[styles.brandName, compact && styles.compactBrandName, { color: colors.text }]}>Pulpo</Text>
      </View>
      <View style={[styles.heading, compact && styles.compactHeading]}>
        <Text accessibilityRole="header" style={[styles.title, compact && styles.compactTitle, { color: colors.text }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, compact && styles.compactSubtitle, { color: colors.textMuted }]}>{subtitle}</Text> : null}
      </View>
      <View style={[styles.form, compact && styles.compactForm]}>{children}</View>
      {footer ? <View style={[styles.footer, compact && styles.compactFooter]}>{footer}</View> : null}
    </ScrollView>
  </KeyboardAvoidingView>;
}

function AuthField({ colors, icon, invalid = false, label, ...props }: AuthFieldProps) {
  const compact = useCompactAuthLayout();
  if (Platform.OS === 'android') return <MaterialField label={label} icon={typeof icon === 'string' ? icon : undefined} error={invalid ? 'Check this value' : undefined} autoCapitalize="none" {...props} />;
  return <View style={[styles.field, compact && styles.compactField, { backgroundColor: colors.surface, borderColor: invalid ? colors.destructive : colors.border }]}>
    <SymbolView name={icon} tintColor={colors.textFaint} size={18} />
    <TextInput accessibilityLabel={label} placeholder={label} placeholderTextColor={colors.textFaint} autoCapitalize="none" style={[styles.input, compact && styles.compactInput, { color: colors.text }]} {...props} />
  </View>;
}

function PrimaryAuthButton({ label, colors, loading = false, disabled = false, icon, onPress }: {
  label: string;
  colors: AuthColors;
  loading?: boolean;
  disabled?: boolean;
  icon?: Parameters<typeof SymbolView>[0]['name'];
  onPress: () => void;
}) {
  const compact = useCompactAuthLayout();
  if (Platform.OS === 'android') return <MaterialButton label={label} onPress={onPress} disabled={disabled} loading={loading} icon={typeof icon === 'string' ? icon : undefined} />;
  const inactive = disabled || loading;
  const backgroundColor = inactive ? colors.border : colors.accent;
  const foregroundColor = inactive ? colors.textMuted : colors.accentText;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={inactive} onPress={onPress} style={[styles.primaryButton, compact && styles.compactPrimaryButton, { backgroundColor }]}>
    {loading ? <ActivityIndicator color={foregroundColor} /> : <><Text style={[styles.primaryButtonText, { color: foregroundColor }]}>{label}</Text>{icon ? <SymbolView name={icon} tintColor={foregroundColor} size={16} weight="semibold" /> : null}</>}
  </Pressable>;
}

function SecondaryAuthButton({ label, colors, loading = false, disabled = false, tonal = false, icon, onPress }: {
  label: string;
  colors: AuthColors;
  loading?: boolean;
  disabled?: boolean;
  tonal?: boolean;
  icon?: Parameters<typeof SymbolView>[0]['name'];
  onPress: () => void;
}) {
  const compact = useCompactAuthLayout();
  if (Platform.OS === 'android') return <MaterialButton label={label} variant="secondary" onPress={onPress} disabled={disabled} loading={loading} icon={typeof icon === 'string' ? icon : undefined} />;
  const inactive = disabled || loading;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={inactive} onPress={onPress} style={[styles.secondaryButton, compact && styles.compactSecondaryButton, { borderColor: colors.border }, tonal && { backgroundColor: colors.surface }, inactive && !loading && styles.inactiveButton]}>
    {loading ? <ActivityIndicator color={colors.text} /> : <>{icon ? <SymbolView name={icon} tintColor={colors.text} size={16} weight="semibold" /> : null}<Text style={[styles.secondaryButtonText, { color: colors.text }]}>{label}</Text></>}
  </Pressable>;
}

function InviteCodeField({ colors, value, disabled, error, onChangeText, onSubmit }: { colors: AuthColors; value: string; disabled: boolean; error: string; onChangeText: (value: string) => void; onSubmit: () => void }) {
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const compact = useCompactAuthLayout();
  const activeIndex = Math.min(value.length, INVITE_CODE_LENGTH - 1);
  return <View style={styles.inviteCode}>
    <Text accessible={false} style={[styles.inviteCodeLabel, { color: colors.text }]} onPress={() => inputRef.current?.focus()}>Invite code</Text>
    <View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.inviteCodeCells, compact && styles.compactInviteCodeCells]}>
        {Array.from({ length: INVITE_CODE_LENGTH }, (_, index) => {
          const active = focused && index === activeIndex;
          return <View key={index} style={[styles.inviteCodeCell, compact && styles.compactInviteCodeCell, (error || active) && styles.emphasizedInviteCodeCell, { backgroundColor: colors.surface, borderColor: error ? colors.destructive : active ? colors.text : colors.border }]}>
            <Text maxFontSizeMultiplier={1.3} style={[styles.inviteCodeCharacter, compact && styles.compactInviteCodeCharacter, { color: colors.text }]}>{value[index] ?? ''}</Text>
          </View>;
        })}
      </View>
      {/* One transparent input over the boxes keeps paste, autofill, and backspace native. */}
      <TextInput
        ref={inputRef}
        accessibilityLabel="Invite code"
        accessibilityHint="Six letters or numbers"
        value={value}
        onChangeText={(next) => onChangeText(nextInviteCode(value, next))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={onSubmit}
        editable={!disabled}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="one-time-code"
        keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
        spellCheck={false}
        returnKeyType="go"
        caretHidden
        selectionColor="transparent"
        style={styles.inviteCodeInput}
      />
    </View>
    {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
  </View>;
}

function BackToSignIn({ colors, onPress, label = 'Back to sign in' }: { colors: AuthColors; onPress: () => void; label?: string }) {
  return <Pressable accessibilityRole="link" onPress={onPress} style={styles.backLink}><Text style={[styles.backLinkText, { color: colors.textMuted }]}>{label}</Text></Pressable>;
}

export function AuthExperience() {
  const theme = useAppTheme();
  const colors: AuthColors = Platform.OS === 'android' ? { background: theme.background, surface: theme.elevated, border: theme.separator, text: theme.text, textMuted: theme.secondary, textFaint: theme.secondary, accent: theme.accent, accentText: theme.accentText, destructive: theme.red } : theme.isDark ? mockupOneDark : mockupOneLight;
  const productionStatus = useSessionStore((state) => state.status);
  const productionUser = useSessionStore((state) => state.user);
  const productionInstanceUrl = useSessionStore((state) => state.instanceUrl);
  const productionConfig = useSessionStore((state) => state.config);
  const login = useSessionStore((state) => state.login);
  const loginWithPasskey = useSessionStore((state) => state.loginWithPasskey);
  const signup = useSessionStore((state) => state.signup);
  const logout = useSessionStore((state) => state.logout);
  const refreshSession = useSessionStore((state) => state.refreshSession);
  const discover = useSessionStore((state) => state.discover);
  const setUser = useSessionStore((state) => state.setUser);
  const switchInstance = useSessionStore((state) => state.switchInstance);
  // Accounts that stay signed in while another one is added.
  const signedInAccounts = useSessionStore((state) => state.accounts);
  const switchAccount = useSessionStore((state) => state.switchAccount);
  const session = {
    status: productionStatus === 'pending' ? 'pending' as const : productionStatus === 'authenticated' ? 'signed-in' as const : 'signed-out' as const,
    user: productionUser ? { ...productionUser, role: productionUser.role === 'pending' ? 'pending' as const : 'member' as const } : null,
  };
  const instance = {
    url: productionInstanceUrl,
    signupOpen: productionConfig?.auth.signupEnabled ?? true,
  };
  const [page, setPage] = useState<AuthPage>('login');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [instanceUrl, setInstanceUrl] = useState(productionInstanceUrl);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [pendingFeedback, setPendingFeedback] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const pendingActionRef = useRef(false);
  const [inviteError, setInviteError] = useState('');
  const [passkeyFallback, setPasskeyFallback] = useState(false);
  const [inviteCode, setInviteCode] = useState('');

  const goTo = (next: AuthPage) => {
    setError('');
    setSent(false);
    setPasskeyFallback(false);
    setPage(next);
  };
  useSubpageBack(page !== 'login', () => goTo('login'));
  const run = async (action: () => Promise<void>) => {
    setError('');
    setLoading(true);
    try {
      await Promise.all([action(), new Promise((resolve) => setTimeout(resolve, 650))]);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };
  const submitLogin = () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid email address.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    void run(async () => {
      const result = await login(email.trim(), password);
      if (result === 'two-factor-required') { setTwoFactorCode(''); setPage('two-factor'); }
    });
  };
  const submitPasskey = (forceBrowser = false) => {
    setError('');
    setPasskeyFallback(false);
    setLoading(true);
    void loginWithPasskey(forceBrowser).catch((nextError) => {
      if (nextError instanceof PasskeyCancelledError) return;
      if (nextError instanceof NativePasskeyError) {
        setPasskeyFallback(true);
        setError('Native passkeys are not available for this server configuration. Continue securely in your browser.');
        return;
      }
      setError(nextError instanceof Error ? nextError.message : 'Could not sign in with a passkey.');
    }).finally(() => setLoading(false));
  };
  const submitTwoFactor = () => {
    if (recoveryMode ? twoFactorCode.trim().length < 12 : !/^\d{6}$/.test(twoFactorCode)) return setError('Enter a valid code.');
    void run(async () => { await login(email.trim(), password, twoFactorCode.trim()); });
  };
  const submitSignup = () => {
    if (name.trim().length < 2) return setError('Enter your display name.');
    if (!/^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$/.test(username)) return setError('Use 3–30 letters, numbers, or underscores for your username.');
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid email address.');
    if (password.length < 8) return setError('Use at least eight characters.');
    if (password !== confirmPassword) return setError('Passwords do not match.');
    void run(() => signup(name.trim(), username, email.trim(), password));
  };
  const submitForgotPassword = () => {
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid email address.');
    void run(async () => { await mobileApi.forgotPassword(email.trim()); setSent(true); });
  };
  const submitInstance = () => {
    setError('');
    let normalized: string;
    try {
      normalized = normalizeInstanceUrl(instanceUrl);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Invalid URL.');
      return;
    }
    void run(async () => {
      await switchInstance(normalized);
      setInstanceUrl(normalized);
      setPage('login');
    });
  };
  const runPendingAction = async (action: PendingAction, task: () => Promise<void>) => {
    // A ref, not state, so two taps in the same frame cannot both start.
    if (pendingActionRef.current) return;
    pendingActionRef.current = true;
    setError('');
    setInviteError('');
    setPendingFeedback('');
    setPendingAction(action);
    try {
      await task();
    } finally {
      pendingActionRef.current = false;
      setPendingAction(null);
    }
  };
  const refreshApproval = () => runPendingAction('refresh', async () => {
    try {
      // Also reload the instance config so pending message and invite changes show up, like the web page's reload.
      await Promise.all([refreshSession(), discover().catch(() => undefined)]);
      if (useSessionStore.getState().status === 'pending') setPendingFeedback('Still waiting for administrator approval.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not refresh approval status. Check your connection and try again.');
    }
  });
  const redeemInvite = async () => {
    if (inviteCode.length !== INVITE_CODE_LENGTH) return;
    await runPendingAction('redeem', async () => {
      const token = useSessionStore.getState().token;
      let redeemed: Awaited<ReturnType<typeof mobileApi.redeemInviteCode>>;
      try {
        redeemed = await mobileApi.redeemInviteCode(inviteCode);
      } catch (nextError) {
        if (useSessionStore.getState().token === token) setInviteError(nextError instanceof Error ? nextError.message : 'Unable to redeem this invite code.');
        return;
      }
      // The session may have expired or switched while the code was being redeemed.
      if (useSessionStore.getState().token !== token) return;
      try {
        await setUser(redeemed.user);
      } catch {
        setPendingFeedback('Invite accepted. Tap Refresh status to continue.');
      }
    });
  };
  const signOut = () => runPendingAction('signout', async () => {
    try {
      await logout();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not sign out.');
    }
  });

  if (session.status === 'pending' && session.user) {
    const auth = productionConfig?.auth;
    return <AuthShell colors={colors} title="Account pending approval" subtitle={auth?.pendingMessage ?? DEFAULT_PENDING_MESSAGE}>
      {auth?.inviteCodesEnabled ? <>
        <InviteCodeField colors={colors} value={inviteCode} disabled={pendingAction === 'redeem'} error={inviteError} onChangeText={(value) => { setInviteCode(value); setInviteError(''); }} onSubmit={() => { void redeemInvite(); }} />
        <PrimaryAuthButton label="Redeem invite code" colors={colors} loading={pendingAction === 'redeem'} disabled={inviteCode.length !== INVITE_CODE_LENGTH || pendingAction !== null} onPress={() => { void redeemInvite(); }} />
      </> : null}
      {auth?.pendingDetails && auth.adminEmail ? <View style={[styles.helpCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <SymbolView name="envelope" size={16} tintColor={colors.textMuted} />
        <View style={styles.helpCopy}>
          <Text style={[styles.helpTitle, { color: colors.text }]}>Need help?</Text>
          <Text style={[styles.helpText, { color: colors.textMuted }]}>Contact your admin at <Text accessibilityRole="link" onPress={() => { void Linking.openURL(`mailto:${auth.adminEmail}`).catch(() => undefined); }} style={[styles.helpLink, { color: colors.text }]}>{auth.adminEmail}</Text></Text>
        </View>
      </View> : null}
      <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.pendingHelp, { color: colors.textMuted }]}>Signed in as <Text style={[styles.helpLink, { color: colors.text }]}>{session.user.email}</Text></Text>
      {pendingFeedback ? <Text accessibilityLiveRegion="polite" style={[styles.pendingHelp, { color: colors.textMuted }]}>{pendingFeedback}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
      <View style={styles.pendingActions}>
        <SecondaryAuthButton label="Sign out" colors={colors} icon="rectangle.portrait.and.arrow.right" loading={pendingAction === 'signout'} disabled={pendingAction !== null} onPress={() => { void signOut(); }} />
        <SecondaryAuthButton label="Refresh status" colors={colors} tonal loading={pendingAction === 'refresh'} disabled={pendingAction !== null} onPress={() => { void refreshApproval(); }} />
      </View>
      <View style={[styles.dangerZone, { borderTopColor: colors.border }]}>
        <Text accessibilityRole="header" style={[styles.dangerTitle, { color: colors.text }]}>Delete account</Text>
        {auth && !auth.accountDeletionEnabled
          ? <Text style={[styles.dangerText, { color: colors.textMuted }]}>Account deletion is disabled by the instance administrator.{auth.adminEmail ? <> Contact <Text accessibilityRole="link" onPress={() => { void Linking.openURL(`mailto:${auth.adminEmail}`).catch(() => undefined); }} style={[styles.helpLink, { color: colors.text }]}>{auth.adminEmail}</Text>.</> : null}</Text>
          : <>
            <Text style={[styles.dangerText, { color: colors.textMuted }]}>Permanently delete your account and its data.</Text>
            <View style={styles.dangerAction}><DeleteAccountAction /></View>
          </>}
      </View>
    </AuthShell>;
  }

  if (page === 'two-factor') return <AuthShell colors={colors} title="Verify your identity" subtitle={recoveryMode ? 'Enter one of your saved recovery codes.' : 'Enter the six-digit code from your authenticator app.'}>
    <AuthField colors={colors} icon="checkmark.shield" label={recoveryMode ? 'Recovery code' : 'Authenticator code'} value={twoFactorCode} onChangeText={(value) => setTwoFactorCode(recoveryMode ? value.toUpperCase() : value.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" keyboardType={recoveryMode ? 'default' : 'number-pad'} maxLength={recoveryMode ? 14 : 6} />
    {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
    <PrimaryAuthButton label="Verify and sign in" colors={colors} loading={loading} disabled={recoveryMode ? twoFactorCode.trim().length < 12 : twoFactorCode.length !== 6} onPress={submitTwoFactor} />
    <BackToSignIn colors={colors} label={recoveryMode ? 'Use an authenticator code' : 'Use a recovery code'} onPress={() => { setRecoveryMode((value) => !value); setTwoFactorCode(''); setError(''); }} />
    <BackToSignIn colors={colors} onPress={() => { setPassword(''); goTo('login'); }} />
  </AuthShell>;

  if (page === 'signup') {
    const valid = Boolean(name.trim() && /^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$/.test(username) && email.trim() && password.length >= 8);
    return <AuthShell colors={colors} title="Create an account" subtitle="Join this Pulpo instance. Your administrator may need to approve new accounts.">
      <AuthField colors={colors} icon="person" label="Display name" value={name} onChangeText={setName} autoComplete="name" />
      <AuthField colors={colors} icon="at" label="Username" value={username} onChangeText={(value) => setUsername(value.replace(/^@/, '').toLowerCase())} autoComplete="username" maxLength={30} />
      <AuthField colors={colors} icon="envelope" label="Email" value={email} onChangeText={setEmail} autoComplete="email" keyboardType="email-address" />
      <AuthField colors={colors} icon="lock" label="Password" value={password} onChangeText={setPassword} autoComplete="new-password" secureTextEntry returnKeyType="go" onSubmitEditing={submitSignup} />
      <AuthField colors={colors} icon="lock" label="Confirm password" invalid={Boolean(confirmPassword && password !== confirmPassword)} value={confirmPassword} onChangeText={setConfirmPassword} autoComplete="new-password" secureTextEntry returnKeyType="go" onSubmitEditing={submitSignup} />
      <Text style={[styles.hint, { color: colors.textFaint }]}>Use at least 8 characters.</Text>
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
      <PrimaryAuthButton label="Create account" colors={colors} loading={loading} disabled={!valid} onPress={submitSignup} />
      <BackToSignIn colors={colors} label="Already have an account? Sign in" onPress={() => goTo('login')} />
    </AuthShell>;
  }

  if (page === 'forgot') return <AuthShell colors={colors} title={sent ? 'Check your email' : 'Reset your password'} subtitle={sent ? 'If this address belongs to a Pulpo account, the instance sent password reset instructions.' : 'Enter the email address for your Pulpo account.'}>
    {!sent ? <>
      <AuthField colors={colors} icon="envelope" label="Email" value={email} onChangeText={setEmail} autoComplete="email" keyboardType="email-address" returnKeyType="go" onSubmitEditing={submitForgotPassword} />
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
      <PrimaryAuthButton label="Send reset link" colors={colors} loading={loading} disabled={!email.trim()} onPress={submitForgotPassword} />
    </> : null}
    <BackToSignIn colors={colors} onPress={() => goTo('login')} />
  </AuthShell>;

  if (page === 'instance') return <AuthShell colors={colors} title="Connect to Pulpo" subtitle="Use the address of your organization’s Pulpo instance. Your conversations stay on that server.">
    <AuthField colors={colors} icon="network" label="Pulpo instance address" invalid={Boolean(error)} value={instanceUrl} onChangeText={setInstanceUrl} autoCorrect={false} keyboardType="url" returnKeyType="go" onSubmitEditing={submitInstance} placeholder="https://pulpo.example.com" />
    {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
    <PrimaryAuthButton label="Continue" colors={colors} loading={loading} disabled={!instanceUrl.trim()} icon="arrow.right" onPress={submitInstance} />
    <Text style={[styles.note, { color: colors.textFaint }]}>HTTPS is required for production instances. Local HTTP is available for development.</Text>
    <BackToSignIn colors={colors} onPress={() => goTo('login')} />
  </AuthShell>;

  if (page === 'login-options') return <AuthShell colors={colors} title="More login options" subtitle="Choose another way to sign in to your Pulpo account.">
    <PrimaryAuthButton label={passkeyFallback ? 'Try passkey in browser' : 'Sign in with a passkey'} colors={colors} loading={loading} icon="person.badge.key" onPress={() => submitPasskey(passkeyFallback)} />
    {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
    <BackToSignIn colors={colors} onPress={() => goTo('login')} />
  </AuthShell>;

  return <AuthShell colors={colors} title={signedInAccounts.length ? 'Add an account' : 'Welcome back'} subtitle={signedInAccounts.length ? 'Sign in to another Pulpo account. Your other accounts stay signed in.' : 'Sign in with your Pulpo account to sync conversations, models, and settings.'} footer={
    <Pressable accessibilityRole="button" accessibilityLabel={`Change server, currently ${instance.url}`} onPress={() => goTo('instance')} style={styles.instanceButton}>
      <SymbolView name="server.rack" tintColor={colors.textFaint} size={14} />
      <Text style={[styles.instanceText, { color: colors.textMuted }]} numberOfLines={1}>{instance.url}</Text>
      <Text style={[styles.change, { color: colors.text }]}>Change</Text>
    </Pressable>
  }>
    <AuthField colors={colors} icon="envelope" label="Email" value={email} onChangeText={setEmail} autoComplete="email" keyboardType="email-address" />
    <AuthField colors={colors} icon="lock" label="Password" value={password} onChangeText={setPassword} autoComplete="current-password" secureTextEntry returnKeyType="go" onSubmitEditing={submitLogin} />
    {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
    <PrimaryAuthButton label="Sign in" colors={colors} loading={loading} disabled={!email.trim() || !password} onPress={submitLogin} />
    {productionConfig?.capabilities.passkeys ? <BackToSignIn colors={colors} label="More login options" onPress={() => goTo('login-options')} /> : null}
    <View style={styles.links}>
      {instance.signupOpen ? <Pressable accessibilityRole="link" onPress={() => goTo('signup')} style={styles.linkTarget}><Text style={[styles.link, { color: colors.text }]}>Create account</Text></Pressable> : null}
      <Pressable accessibilityRole="link" onPress={() => goTo('forgot')} style={styles.linkTarget}><Text style={[styles.link, { color: colors.textMuted }]}>Forgot password?</Text></Pressable>
    </View>
    {signedInAccounts.map((account) => <BackToSignIn key={account.id} colors={colors} label={`Back to ${account.name}`} onPress={() => { void run(() => switchAccount(account.id)); }} />)}
  </AuthShell>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flexGrow: 1, width: '100%', maxWidth: FORM_CONTENT_MAX, alignSelf: 'center', paddingHorizontal: 22 },
  compactContent: { paddingHorizontal: 20 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  compactBrand: { gap: 9 },
  logo: { width: 42, height: 42, borderRadius: 13 },
  compactLogo: { width: 36, height: 36, borderRadius: 11 },
  brandName: { fontSize: 24, fontWeight: '700', letterSpacing: -0.7 },
  compactBrandName: { fontSize: 22 },
  heading: { marginTop: 72 },
  compactHeading: { marginTop: 28 },
  title: { fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: -1.1 },
  compactTitle: { fontSize: 30, lineHeight: 35, letterSpacing: -0.9 },
  subtitle: { marginTop: 9, fontSize: 17, lineHeight: 24 },
  compactSubtitle: { marginTop: 6, fontSize: 15.5, lineHeight: 21 },
  form: { marginTop: 32, gap: 14 },
  compactForm: { marginTop: 20, gap: 10 },
  footer: { marginTop: 'auto', paddingTop: 32 },
  compactFooter: { paddingTop: 8 },
  field: { minHeight: 56, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  compactField: { minHeight: 50, borderRadius: 15 },
  input: { flex: 1, fontSize: 17, paddingVertical: 14 },
  compactInput: { fontSize: 16, paddingVertical: 11 },
  hint: { fontSize: 12.5, marginTop: -6, marginLeft: 8 },
  error: { fontSize: 13.5, lineHeight: 19 },
  primaryButton: { minHeight: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  compactPrimaryButton: { minHeight: 48, borderRadius: 15 },
  primaryButtonText: { fontSize: 16, fontWeight: '600' },
  secondaryButton: { minHeight: 50, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  compactSecondaryButton: { minHeight: 46, borderRadius: 15 },
  inactiveButton: { opacity: 0.5 },
  secondaryButtonText: { fontSize: 16, fontWeight: '600' },
  links: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  linkTarget: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  link: { fontSize: 13.5, fontWeight: '600' },
  backLink: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  backLinkText: { fontSize: 13.5, fontWeight: '600' },
  instanceButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12 },
  instanceText: { maxWidth: 210, fontSize: 12.5 },
  change: { fontSize: 12.5, fontWeight: '600' },
  note: { fontSize: 12.5, lineHeight: 18, textAlign: 'center', paddingHorizontal: 10 },
  pendingHelp: { fontSize: 13.5, lineHeight: 20 },
  pendingActions: { gap: 10 },
  inviteCode: { gap: 10 },
  inviteCodeLabel: { fontSize: 15, fontWeight: '600' },
  inviteCodeCells: { flexDirection: 'row', gap: 10 },
  compactInviteCodeCells: { gap: 8 },
  inviteCodeCell: { flex: 1, aspectRatio: 1, maxHeight: 64, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  compactInviteCodeCell: { borderRadius: 12 },
  emphasizedInviteCodeCell: { borderWidth: 1.5 },
  inviteCodeCharacter: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 22, fontWeight: '600' },
  compactInviteCodeCharacter: { fontSize: 20 },
  inviteCodeInput: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, color: 'transparent', backgroundColor: 'transparent', fontSize: 1 },
  helpCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  helpCopy: { flex: 1, gap: 2 },
  helpTitle: { fontSize: 14, fontWeight: '600' },
  helpText: { fontSize: 14, lineHeight: 20 },
  helpLink: { fontWeight: '600' },
  dangerZone: { marginTop: 10, paddingTop: 20, borderTopWidth: StyleSheet.hairlineWidth, gap: 4 },
  dangerTitle: { fontSize: 15, fontWeight: '600' },
  dangerText: { fontSize: 13.5, lineHeight: 19 },
  dangerAction: { alignItems: 'flex-start', marginTop: 4, marginLeft: Platform.OS === 'ios' ? -8 : 0 },
});
