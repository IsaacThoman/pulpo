import type { ComponentProps, PropsWithChildren, ReactNode } from 'react';
import { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { useAppTheme } from '../theme';
import { normalizeInstanceUrl } from '../domain';
import { mobileApi } from '../../../api/client';
import { useSessionStore } from '../../../store/session';

type AuthPage = 'login' | 'signup' | 'forgot' | 'instance';

const mockupOneDark = {
  background: '#101014', surface: '#18181C', border: '#303036', text: '#FAFAFA',
  textMuted: '#A1A1AA', textFaint: '#98989D', accent: '#F4F4F5', accentText: '#18181B', destructive: '#FF453A',
};

const mockupOneLight = {
  background: '#FFFFFF', surface: '#F8F8FA', border: '#E2E2E7', text: '#18181B',
  textMuted: '#64646D', textFaint: '#6E6E73', accent: '#18181B', accentText: '#FFFFFF', destructive: '#FF3B30',
};

type AuthColors = Record<keyof typeof mockupOneDark, string>;
type AuthFieldProps = ComponentProps<typeof TextInput> & {
  colors: AuthColors;
  icon: Parameters<typeof SymbolView>[0]['name'];
  invalid?: boolean;
  label: string;
};

function AuthShell({ title, subtitle, children, footer, colors }: PropsWithChildren<{ title: string; subtitle: string; footer?: ReactNode; colors: AuthColors }>) {
  const insets = useSafeAreaInsets();
  return <KeyboardAvoidingView style={[styles.root, { backgroundColor: colors.background }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingTop: insets.top + 42, paddingBottom: insets.bottom + 24 }]}>
      <View style={styles.brand}>
        <Image source={require('../../assets/pulpo-smiley.png')} style={styles.logo} />
        <Text style={[styles.brandName, { color: colors.text }]}>Pulpo</Text>
      </View>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>{subtitle}</Text>
      </View>
      <View style={styles.form}>{children}</View>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </ScrollView>
  </KeyboardAvoidingView>;
}

function AuthField({ colors, icon, invalid = false, label, ...props }: AuthFieldProps) {
  return <View style={[styles.field, { backgroundColor: colors.surface, borderColor: invalid ? colors.destructive : colors.border }]}>
    <SymbolView name={icon} tintColor={colors.textFaint} size={18} />
    <TextInput accessibilityLabel={label} placeholder={label} placeholderTextColor={colors.textFaint} autoCapitalize="none" style={[styles.input, { color: colors.text }]} {...props} />
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
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled || loading} onPress={onPress} style={[styles.primaryButton, { backgroundColor: colors.accent, opacity: disabled || loading ? 0.45 : 1 }]}>
    {loading ? <ActivityIndicator color={colors.accentText} /> : <><Text style={[styles.primaryButtonText, { color: colors.accentText }]}>{label}</Text>{icon ? <SymbolView name={icon} tintColor={colors.accentText} size={16} weight="semibold" /> : null}</>}
  </Pressable>;
}

function BackToSignIn({ colors, onPress, label = 'Back to sign in' }: { colors: AuthColors; onPress: () => void; label?: string }) {
  return <Pressable accessibilityRole="link" onPress={onPress} style={styles.backLink}><Text style={[styles.backLinkText, { color: colors.textMuted }]}>{label}</Text></Pressable>;
}

export function AuthExperience() {
  const theme = useAppTheme();
  const colors = theme.isDark ? mockupOneDark : mockupOneLight;
  const productionStatus = useSessionStore((state) => state.status);
  const productionUser = useSessionStore((state) => state.user);
  const productionInstanceUrl = useSessionStore((state) => state.instanceUrl);
  const productionConfig = useSessionStore((state) => state.config);
  const login = useSessionStore((state) => state.login);
  const signup = useSessionStore((state) => state.signup);
  const logout = useSessionStore((state) => state.logout);
  const refreshSession = useSessionStore((state) => state.refreshSession);
  const switchInstance = useSessionStore((state) => state.switchInstance);
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [instanceUrl, setInstanceUrl] = useState(productionInstanceUrl);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [pendingFeedback, setPendingFeedback] = useState('');

  const goTo = (next: AuthPage) => {
    setError('');
    setSent(false);
    setPage(next);
  };
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
    void run(() => login(email.trim(), password));
  };
  const submitSignup = () => {
    if (name.trim().length < 2) return setError('Enter your full name.');
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid email address.');
    if (password.length < 8) return setError('Use at least eight characters.');
    if (password !== confirmPassword) return setError('Passwords do not match.');
    void run(() => signup(name.trim(), email.trim(), password));
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
  const refreshApproval = async () => {
    setError('');
    setPendingFeedback('');
    setLoading(true);
    try {
      await refreshSession();
      if (useSessionStore.getState().status === 'pending') setPendingFeedback('Still waiting for administrator approval.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not refresh approval status. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  if (session.status === 'pending' && session.user) return <AuthShell colors={colors} title="Approval needed" subtitle="Your Pulpo account is ready, but an administrator needs to approve it before you can start chatting.">
    <View style={[styles.pendingCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <SymbolView name="person.crop.circle.badge.clock" size={28} tintColor={colors.textMuted} />
      <View style={styles.pendingIdentity}>
        <Text style={[styles.pendingName, { color: colors.text }]}>{session.user.name}</Text>
        <Text style={[styles.pendingEmail, { color: colors.textMuted }]}>{session.user.email}</Text>
      </View>
    </View>
    <Text style={[styles.pendingHelp, { color: colors.textMuted }]}>Refresh after your administrator approves the account. Pulpo will open your chats automatically.</Text>
    {pendingFeedback ? <Text accessibilityLiveRegion="polite" style={[styles.pendingHelp, { color: colors.textMuted }]}>{pendingFeedback}</Text> : null}
    {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
    <PrimaryAuthButton label="Refresh status" colors={colors} loading={loading} onPress={() => { void refreshApproval(); }} />
    <Pressable accessibilityRole="button" onPress={() => { void logout(); }} style={[styles.secondaryButton, { borderColor: colors.border }]}><Text style={[styles.secondaryButtonText, { color: colors.text }]}>Back to sign in</Text></Pressable>
  </AuthShell>;

  if (page === 'signup') {
    const valid = Boolean(name.trim() && email.trim() && password.length >= 8);
    return <AuthShell colors={colors} title="Create an account" subtitle="Join this Pulpo instance. Your administrator may need to approve new accounts.">
      <AuthField colors={colors} icon="person" label="Name" value={name} onChangeText={setName} autoComplete="name" />
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

  return <AuthShell colors={colors} title="Welcome back" subtitle="Sign in with your Pulpo account to sync conversations, models, and settings." footer={
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
    <View style={styles.links}>
      {instance.signupOpen ? <Pressable accessibilityRole="link" onPress={() => goTo('signup')} style={styles.linkTarget}><Text style={[styles.link, { color: colors.text }]}>Create account</Text></Pressable> : null}
      <Pressable accessibilityRole="link" onPress={() => goTo('forgot')} style={styles.linkTarget}><Text style={[styles.link, { color: colors.textMuted }]}>Forgot password?</Text></Pressable>
    </View>
  </AuthShell>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 22 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 42, height: 42, borderRadius: 13 },
  brandName: { fontSize: 24, fontWeight: '700', letterSpacing: -0.7 },
  heading: { marginTop: 72 },
  title: { fontSize: 34, lineHeight: 40, fontWeight: '700', letterSpacing: -1.1 },
  subtitle: { marginTop: 9, fontSize: 17, lineHeight: 24 },
  form: { marginTop: 32, gap: 14 },
  footer: { marginTop: 'auto', paddingTop: 32 },
  field: { minHeight: 56, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, fontSize: 17, paddingVertical: 14 },
  hint: { fontSize: 12.5, marginTop: -6, marginLeft: 8 },
  error: { fontSize: 13.5, lineHeight: 19 },
  primaryButton: { minHeight: 52, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryButtonText: { fontSize: 16, fontWeight: '600' },
  secondaryButton: { minHeight: 50, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
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
  pendingCard: { minHeight: 74, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  pendingIdentity: { flex: 1, gap: 2 },
  pendingName: { fontSize: 16, fontWeight: '600' },
  pendingEmail: { fontSize: 13.5 },
  pendingHelp: { fontSize: 13.5, lineHeight: 20 },
});
