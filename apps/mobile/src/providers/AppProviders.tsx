import { useEffect, useMemo } from 'react'
import { AppState, Keyboard, View } from 'react-native'
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query'
import * as Network from 'expo-network'
import * as SplashScreen from 'expo-splash-screen'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { usePreferencesStore } from '../store/preferences'
import { useSessionStore } from '../store/session'
import { isNetworkError } from '../api/client'
import { useAppTheme } from '../theme'
import { purgeLegacyPrototypeSnapshots } from '../mockup5/src/store/prototypeStore'
import { RealtimeProvider } from './RealtimeProvider'
import { startKeyboardStateReconciliation } from './keyboardStateReconciliation'

void SplashScreen.preventAutoHideAsync()

function KeyboardStateReconciler({ children }: { children: React.ReactNode }) {
  const { height, progress } = useReanimatedKeyboardAnimation()

  useEffect(() => startKeyboardStateReconciliation({
    addAppStateChangeListener: (listener) => AppState.addEventListener('change', listener),
    addKeyboardDidHideListener: (listener) => Keyboard.addListener('keyboardDidHide', listener),
    isKeyboardVisible: () => Keyboard.isVisible(),
    reset: () => {
      height.value = 0
      progress.value = 0
    },
  }), [height, progress])

  return children
}

function Bootstrap({ children }: { children: React.ReactNode }) {
  const hydrateSession = useSessionStore((state) => state.hydrate)
  const sessionStatus = useSessionStore((state) => state.status)
  const hydratePreferences = usePreferencesStore((state) => state.hydrate)
  const preferencesHydrated = usePreferencesStore((state) => state.hydrated)
  const theme = useAppTheme()

  useEffect(() => {
    void Promise.allSettled([hydrateSession(), hydratePreferences(), purgeLegacyPrototypeSnapshots()]).then(() => {
      if (useSessionStore.getState().status === 'hydrating') {
        useSessionStore.setState({ status: 'anonymous', error: 'Could not finish loading the app.' })
      }
      if (!usePreferencesStore.getState().hydrated) usePreferencesStore.setState({ hydrated: true })
    })
  }, [hydratePreferences, hydrateSession])

  useEffect(() => {
    const update = async () => {
      const state = await Network.getNetworkStateAsync()
      onlineManager.setOnline(Boolean(state.isConnected && state.isInternetReachable !== false))
    }
    void update()
    const subscription = Network.addNetworkStateListener((state) => {
      onlineManager.setOnline(Boolean(state.isConnected && state.isInternetReachable !== false))
    })
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active')
    })
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    if (sessionStatus !== 'hydrating' && preferencesHydrated) void SplashScreen.hideAsync()
    const failsafe = setTimeout(() => { void SplashScreen.hideAsync() }, 20_000)
    return () => clearTimeout(failsafe)
  }, [preferencesHydrated, sessionStatus])

  return <View style={{ flex: 1, backgroundColor: theme.background }}>
    <StatusBar style={theme.isDark ? 'light' : 'dark'} />
    {children}
  </View>
}

export function AppProviders({ children }: { children: React.ReactNode }) {
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
  return <GestureHandlerRootView style={{ flex: 1 }}>
    <KeyboardProvider>
      <KeyboardStateReconciler>
        <SafeAreaProvider>
          <QueryClientProvider client={queryClient}>
            <Bootstrap><RealtimeProvider>{children}</RealtimeProvider></Bootstrap>
          </QueryClientProvider>
        </SafeAreaProvider>
      </KeyboardStateReconciler>
    </KeyboardProvider>
  </GestureHandlerRootView>
}
