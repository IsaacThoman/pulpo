import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/index.css'
import App from '@/App'
import { QueryProvider } from '@/lib/query'
import { I18nBridge } from '@/i18n/I18nBridge'
import { LocaleBoundary } from '@/i18n/LocaleBoundary'
import '@/i18n/index'

document.documentElement.dataset.desktop = 'true'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryProvider>
      <I18nBridge />
      <LocaleBoundary><App /></LocaleBoundary>
    </QueryProvider>
  </StrictMode>,
)
