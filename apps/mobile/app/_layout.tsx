import { Slot, usePathname } from 'expo-router'
import { AppProviders } from '@/providers/AppProviders'
import Mockup5App from '@/mockup5/App'
import { configureClientPlatform } from '@/api/client'
import { mobileClientPlatform } from '@/api/clientPlatform'

configureClientPlatform(mobileClientPlatform())

export default function RootLayout() {
  const pathname = usePathname()
  const shareToken = pathname.match(/^\/share\/([^/]+)/)?.[1]
  return <AppProviders>{shareToken
    ? <Slot />
    : <Mockup5App />}
  </AppProviders>
}
