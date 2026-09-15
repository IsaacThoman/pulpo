import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import '../../src/index.css'
import i18n from '../../src/i18n'
import { queryClient } from '../../src/lib/query-client'
import { useAuth } from '../../src/stores/auth'
import { BillingPage } from '../../src/pages/BillingPage'
import { TooltipProvider } from '../../src/components/ui/tooltip'
const params = new URLSearchParams(location.search)
await i18n.changeLanguage(params.get('locale') ?? 'en-US')
document.documentElement.classList.toggle('dark', params.has('dark'))
useAuth.setState({ user: { id: 'billing-qa', balanceMicros: 12000000 } as NonNullable<ReturnType<typeof useAuth.getState>['user']> })
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={queryClient}><MemoryRouter><TooltipProvider><BillingPage /></TooltipProvider></MemoryRouter></QueryClientProvider>)
