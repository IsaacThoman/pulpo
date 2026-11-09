import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import '../../src/index.css'
import i18n from '../../src/i18n'
import { PeopleHeader } from '../../src/pages/PeopleLayout'
import { useAuth } from '../../src/stores/auth'

const params = new URLSearchParams(location.search)
await i18n.changeLanguage(params.get('locale') ?? 'en-US')
useAuth.setState({
  user: {
    id: 'people-user', name: 'Alexandria Catherine Montgomery', email: 'audit@example.test', username: 'alexandria', avatarUrl: null, profileColor: null,
    usageVisibility: 'friends', role: 'user', initials: 'AM', balanceMicros: 0, storageLimitBytes: 0, blocked: false,
    stateRevision: 1, createdAt: '2026-09-01T00:00:00Z',
  },
})

// The page root sits directly under `.app-main`, so phones apply the drawer button's header padding as in the app.
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}>
  <MemoryRouter initialEntries={[params.get('path') ?? '/friends']}>
    <main className="app-main"><div className="flex h-full flex-col"><PeopleHeader /></div></main>
  </MemoryRouter>
</QueryClientProvider>)
