import { useEffect, useState, type ReactNode } from 'react'
import { AppState } from 'react-native'
import * as Network from 'expo-network'
import { onlineManager } from '@tanstack/react-query'
import { useRealtimeStore } from './realtimeStore'
import { OfflineContext } from './useNetworkOffline'

export function ConnectivityProvider({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState<Network.NetworkState>({})
  const connected = useRealtimeStore((state) => state.connected)
  // Android's network validation can fail while Pulpo remains reachable.
  // A connected Pulpo transport is stronger evidence than the OS hint.
  const offline = !connected && (network.isConnected === false || network.isInternetReachable === false)

  useEffect(() => {
    onlineManager.setOnline(!offline)
  }, [offline])

  useEffect(() => {
    let disposed = false
    let revision = 0
    const refresh = async () => {
      const requestedRevision = ++revision
      try {
        const next = await Network.getNetworkStateAsync()
        if (!disposed && revision === requestedRevision) setNetwork(next)
      } catch {
        // A failed native lookup is not evidence that the network is offline.
      }
    }
    const networkSubscription = Network.addNetworkStateListener((next) => {
      revision += 1
      setNetwork(next)
    })
    const appSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh()
    })
    void refresh()
    return () => {
      disposed = true
      networkSubscription.remove()
      appSubscription.remove()
    }
  }, [])

  return <OfflineContext.Provider value={offline}>{children}</OfflineContext.Provider>
}
