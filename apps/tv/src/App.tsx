import { useEffect, useMemo, type ReactNode } from 'react'
import { ActivityIndicator, AppState, BackHandler, StatusBar, TVEventControl, View } from 'react-native'
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query'
import * as SplashScreen from 'expo-splash-screen'
import { configureClientPlatform, isNetworkError } from '@/api/client'
import { mobileClientPlatform } from '@/api/clientPlatform'
import { ConnectivityProvider } from '@/providers/ConnectivityProvider'
import { RealtimeProvider } from '@/providers/RealtimeProvider'
import { runWhenAppActive } from '@/providers/runWhenAppActive'
import { usePreferencesStore } from '@/store/preferences'
import { useSessionStore } from '@/store/session'
import { useNamespace, useServerPreferences } from './data'
import { canGoBack, useNavigation } from './navigation'
import { Chat } from './screens/Chat'
import { Home } from './screens/Home'
import { Library } from './screens/Library'
import { Overlays } from './screens/Overlays'
import { Settings } from './screens/Settings'
import { Pending, SignIn } from './screens/SignIn'
import { useTVTheme } from './theme'

configureClientPlatform(mobileClientPlatform())
void SplashScreen.preventAutoHideAsync()

function Bootstrap({ children }: { children: ReactNode }) {
  const status = useSessionStore((state) => state.status)
  const hydrated = usePreferencesStore((state) => state.hydrated)

  useEffect(() => runWhenAppActive(AppState, () => {
    void Promise.allSettled([useSessionStore.getState().hydrate(), usePreferencesStore.getState().hydrate()]).then(() => {
      if (useSessionStore.getState().status === 'hydrating') {
        useSessionStore.setState({ status: 'anonymous', error: 'Could not finish loading the app.' })
      }
      if (!usePreferencesStore.getState().hydrated) usePreferencesStore.setState({ hydrated: true })
    })
  }), [])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => focusManager.setFocused(state === 'active'))
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    if (status !== 'hydrating' && hydrated) void SplashScreen.hideAsync()
  }, [hydrated, status])

  return children
}

/** The Menu button pops screens and overlays, and leaves the app from Home. */
function useMenuButton() {
  const back = useNavigation(canGoBack)
  useEffect(() => {
    if (back) TVEventControl.enableTVMenuKey()
    else TVEventControl.disableTVMenuKey()
  }, [back])
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => useNavigation.getState().pop())
    return () => subscription.remove()
  }, [])
}

function SignedIn({ namespace }: { namespace: string }) {
  useServerPreferences(namespace)
  const route = useNavigation((state) => state.stack.at(-1)!)
  const overlay = useNavigation((state) => state.overlay)
  // Screens beneath an overlay stay mounted but cannot take focus.
  const screen = route.name === 'chat' ? <Chat key={route.chatId} namespace={namespace} chatId={route.chatId} />
    : route.name === 'library' ? <Library namespace={namespace} />
      : route.name === 'settings' ? <Settings />
        : <Home namespace={namespace} />
  return <>
    <View style={{ flex: 1 }} pointerEvents={overlay ? 'none' : 'auto'} importantForAccessibility={overlay ? 'no-hide-descendants' : 'auto'}>{screen}</View>
    <Overlays namespace={namespace} />
  </>
}

function Root() {
  const theme = useTVTheme()
  const status = useSessionStore((state) => state.status)
  const namespace = useNamespace()
  const reset = useNavigation((state) => state.reset)
  useMenuButton()
  useEffect(() => { reset() }, [namespace, reset])

  return <View style={{ flex: 1, backgroundColor: theme.background }}>
    <StatusBar hidden />
    {status === 'hydrating' ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" color={theme.secondary} /></View>
      : status === 'pending' ? <Pending />
        : status === 'authenticated' && namespace ? <SignedIn key={namespace} namespace={namespace} />
          : <SignIn />}
  </View>
}

export default function App() {
  const queryClient = useMemo(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 20_000,
        gcTime: 24 * 60 * 60 * 1_000,
        retry: (failureCount, error) => failureCount < 2 && isNetworkError(error),
        networkMode: 'offlineFirst',
      },
      mutations: { retry: 0, networkMode: 'online' },
    },
  }), [])
  return <QueryClientProvider client={queryClient}>
    <ConnectivityProvider>
      <Bootstrap>
        <RealtimeProvider><Root /></RealtimeProvider>
      </Bootstrap>
    </ConnectivityProvider>
  </QueryClientProvider>
}
