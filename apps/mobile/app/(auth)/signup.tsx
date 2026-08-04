import { useState } from 'react'
import { router } from 'expo-router'
import { ApiError } from '@/api/client'
import { AuthButton, AuthError, AuthField, AuthLink, AuthShell } from '@/features/auth/AuthShell'
import { useSessionStore } from '@/store/session'

export default function SignupScreen() {
  const signup = useSessionStore((state) => state.signup)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const submit = async () => {
    setLoading(true); setError('')
    try { await signup(name, email, password) } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not create your account.')
    } finally { setLoading(false) }
  }
  return <AuthShell title="Create an account" subtitle="Join this Pulpo instance. Your administrator may need to approve new accounts.">
    <AuthField icon="person" label="Name" value={name} onChangeText={setName} autoComplete="name" />
    <AuthField icon="envelope" label="Email" value={email} onChangeText={setEmail} autoComplete="email" keyboardType="email-address" />
    <AuthField icon="lock" label="Password" value={password} onChangeText={setPassword} autoComplete="new-password" secureTextEntry returnKeyType="go" onSubmitEditing={() => { void submit() }} />
    <AuthError>{error}</AuthError>
    <AuthButton label="Create account" loading={loading} disabled={!name.trim() || !email.trim() || password.length < 8} onPress={() => { void submit() }} />
    <AuthLink label="Already have an account? Sign in" onPress={() => router.back()} />
  </AuthShell>
}
