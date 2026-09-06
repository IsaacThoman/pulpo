import { createContext, useContext } from 'react'

export const OfflineContext = createContext(false)

export function useNetworkOffline(): boolean {
  return useContext(OfflineContext)
}
