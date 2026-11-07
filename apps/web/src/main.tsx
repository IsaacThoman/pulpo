import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { QueryProvider } from './lib/query.tsx'
import { I18nBridge } from './i18n/I18nBridge.tsx'
import { LocaleBoundary } from './i18n/LocaleBoundary.tsx'
import './i18n/index.ts'
import { AppErrorBoundary } from './components/AppErrorBoundary.tsx'
import { installStaleBuildReload } from './lib/stale-build.ts'

installStaleBuildReload()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryProvider>
        <I18nBridge />
        <LocaleBoundary><App /></LocaleBoundary>
      </QueryProvider>
    </AppErrorBoundary>
  </StrictMode>,
)
