import { Slot, usePathname } from 'expo-router'
import { AppProviders } from '@/providers/AppProviders'
import Mockup5App from '@/mockup5/App'

export default function RootLayout() {
  const pathname = usePathname()
  const shareToken = pathname.match(/^\/share\/([^/]+)/)?.[1]
  return <AppProviders>{shareToken
    ? <Slot />
    : <Mockup5App />}
  </AppProviders>
}
