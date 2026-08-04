import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { router } from 'expo-router'
import { SymbolView } from 'expo-symbols'
import { ApiError } from '@/api/client'
import { AuthButton, AuthError, AuthField, AuthLink, AuthShell, authStyles } from '@/features/auth/AuthShell'
import { useSessionStore } from '@/store/session'
import { useAppTheme } from '@/theme'

export default function LoginScreen() {
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  const login = useSessionStore((state) => state.login)
  const config = useSessionStore((state) => state.config)
  const sessionError = useSessionStore((state) => state.error)
  const theme = useAppTheme()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(sessionError ?? '')
  const [loading, setLoading] = useState(false)
  const submit = async () => {
    setLoading(true); setError('')
    try { await login(email, password) } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not sign in. Check your connection and try again.')
    } finally { setLoading(false) }
  }
  return <AuthShell title="Welcome back" subtitle="Sign in with your Pulpo account to sync conversations, models, and settings." footer={
    <Pressable accessibilityRole="button" onPress={() => router.push('/(auth)/connect')} style={authStyles.instanceButton}>
      <SymbolView name="server.rack" tintColor={theme.tertiary} size={14} />
      <Text style={[authStyles.instanceText, { color: theme.secondary }]} numberOfLines={1}>{instanceUrl}</Text>
      <Text style={[authStyles.instanceText, { color: theme.text, fontWeight: '600' }]}>Change</Text>
    </Pressable>
  }>
    <AuthField icon="envelope" label="Email" value={email} onChangeText={setEmail} autoComplete="email" keyboardType="email-address" />
    <AuthField icon="lock" label="Password" value={password} onChangeText={setPassword} autoComplete="current-password" secureTextEntry returnKeyType="go" onSubmitEditing={() => { void submit() }} />
    <AuthError>{error}</AuthError>
    <AuthButton label="Sign in" loading={loading} disabled={!email.trim() || !password} onPress={() => { void submit() }} />
    <View style={authStyles.footerLinks}>
      {config?.auth.signupEnabled ? <AuthLink label="Create account" onPress={() => router.push('/(auth)/signup')} /> : null}
      <AuthLink label="Forgot password?" onPress={() => router.push('/(auth)/forgot-password')} />
    </View>
  </AuthShell>
}
