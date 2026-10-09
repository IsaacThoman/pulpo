import { useRef, useState } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { useSessionStore } from '@/store/session'
import { Field } from '../components/Field'
import { IconButton } from '../components/IconButton'
import { Smiley } from '../components/Smiley'
import { SAFE, useTVTheme, type } from '../theme'

function host(url: string): string {
  try { return new URL(url).host } catch { return url }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong'
}

export function SignIn() {
  const theme = useTVTheme()
  const instanceUrl = useSessionStore((state) => state.instanceUrl)
  const login = useSessionStore((state) => state.login)
  const switchInstance = useSessionStore((state) => state.switchInstance)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [server, setServer] = useState<string | null>(null)
  const [needsCode, setNeedsCode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Entering the email hands the remote's focus on to the password.
  const [passwordNext, setPasswordNext] = useState(false)
  const handOff = useRef(false)

  const submit = async () => {
    if (busy || !email.trim() || !password) return
    setBusy(true)
    setError(null)
    try {
      const result = await login(email, password, needsCode ? code.trim() : undefined)
      if (result === 'two-factor-required') setNeedsCode(true)
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }

  const saveServer = async () => {
    if (server === null || busy) return
    setBusy(true)
    setError(null)
    try {
      await switchInstance(server.trim())
      setServer(null)
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }

  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SAFE.horizontal }}>
    <View style={{ width: 760, gap: 28, alignItems: 'stretch' }}>
      <View style={{ alignItems: 'center', marginBottom: 28 }}><Smiley size={180} /></View>
      {server !== null ? <>
        <Field testID="server" icon="server.rack" value={server} onChangeText={setServer} placeholder="pulpo.baby"
          autoCapitalize="none" autoCorrect={false} keyboardType="url" onSubmitEditing={saveServer} hasTVPreferredFocus />
        <View style={{ flexDirection: 'row', gap: 24, justifyContent: 'center' }}>
          <IconButton icon="checkmark" label="Connect" onPress={saveServer} />
          <IconButton icon="xmark" label="Cancel" onPress={() => setServer(null)} />
        </View>
      </> : needsCode ? <>
        <Field testID="code" icon="lock.shield" value={code} onChangeText={setCode} placeholder="Verification code"
          keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code" onSubmitEditing={submit} hasTVPreferredFocus />
        <View style={{ flexDirection: 'row', gap: 24, justifyContent: 'center' }}>
          <IconButton testID="continue" icon="arrow.right" label="Continue" onPress={submit} />
          <IconButton icon="xmark" label="Cancel" onPress={() => { setNeedsCode(false); setCode('') }} />
        </View>
      </> : <>
        <Field testID="email" icon="envelope" value={email} onChangeText={setEmail} placeholder="Email"
          autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="username"
          autoComplete="email" hasTVPreferredFocus={!passwordNext}
          onFocus={() => setPasswordNext(false)}
          onEndEditing={(event) => { handOff.current = Boolean(event.nativeEvent.text.trim()) }}
          // Focus returns here when the keyboard closes; only then can it move on.
          onFocusChange={(focused) => { if (focused && handOff.current) { handOff.current = false; setPasswordNext(true) } }} />
        <Field testID="password" icon="key" hasTVPreferredFocus={passwordNext} value={password} onChangeText={setPassword} placeholder="Password"
          secureTextEntry textContentType="password" autoComplete="password" onSubmitEditing={submit} />
        <View style={{ alignItems: 'center', marginTop: 12 }}>
          {busy ? <View style={{ height: 76, justifyContent: 'center' }}><ActivityIndicator size="large" color={theme.text} /></View>
            : <IconButton testID="sign-in" icon="arrow.right" label="Sign in" onPress={submit} disabled={!email.trim() || !password} />}
        </View>
      </>}
      <Text testID="sign-in-error" style={{ minHeight: 40, textAlign: 'center', fontSize: type.caption, color: theme.red }}>{error ?? ''}</Text>
    </View>
    {server === null ? <View style={{ position: 'absolute', bottom: SAFE.vertical, right: SAFE.horizontal }}>
      <IconButton icon="server.rack" label={host(instanceUrl)} onPress={() => setServer(host(instanceUrl))} />
    </View> : null}
  </View>
}

export function Pending() {
  const theme = useTVTheme()
  const logout = useSessionStore((state) => state.logout)
  const refresh = useSessionStore((state) => state.refreshSession)
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 40 }}>
    <Smiley size={180} />
    <Text style={{ fontSize: type.title, fontWeight: '700', color: theme.text }}>Waiting for approval</Text>
    <View style={{ flexDirection: 'row', gap: 24 }}>
      <IconButton icon="arrow.clockwise" label="Check again" onPress={() => { void refresh().catch(() => undefined) }} hasTVPreferredFocus />
      <IconButton icon="rectangle.portrait.and.arrow.right" label="Sign out" onPress={() => { void logout() }} />
    </View>
  </View>
}
