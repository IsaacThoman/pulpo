import { useState } from 'react'
import { router } from 'expo-router'
import { mobileApi } from '@/api/client'
import { AuthButton, AuthError, AuthField, AuthLink, AuthShell } from '@/features/auth/AuthShell'

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const submit = async () => {
    setLoading(true); setError('')
    try { await mobileApi.forgotPassword(email); setSent(true) } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not request a reset link.')
    } finally { setLoading(false) }
  }
  return <AuthShell title={sent ? 'Check your email' : 'Reset your password'} subtitle={sent ? 'If this address belongs to a Pulpo account, the instance sent password reset instructions.' : 'Enter the email address for your Pulpo account.'}>
    {!sent ? <><AuthField icon="envelope" label="Email" value={email} onChangeText={setEmail} autoComplete="email" keyboardType="email-address" returnKeyType="go" onSubmitEditing={() => { void submit() }} /><AuthError>{error}</AuthError><AuthButton label="Send reset link" loading={loading} disabled={!email.trim()} onPress={() => { void submit() }} /></> : null}
    <AuthLink label="Back to sign in" onPress={() => router.replace('/(auth)/login')} />
  </AuthShell>
}
