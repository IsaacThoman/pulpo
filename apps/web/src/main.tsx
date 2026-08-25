import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { QueryProvider } from './lib/query.tsx'
import { I18nBridge } from './i18n/I18nBridge.tsx'
import { LocaleBoundary } from './i18n/LocaleBoundary.tsx'
import './i18n/index.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryProvider>
      <I18nBridge />
      <LocaleBoundary><App /></LocaleBoundary>
    </QueryProvider>
  </StrictMode>,
)
