import { useLayoutEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/stores/auth'
import { LandingContent } from './LandingContent'

/** Signed-out visitors see the landing page in the system theme, whatever theme this device last saved. */
function useSystemTheme() {
  useLayoutEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const root = document.documentElement
    const savedDark = root.classList.contains('dark')
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => root.classList.toggle('dark', media.matches)
    apply()
    media.addEventListener('change', apply)
    return () => {
      media.removeEventListener('change', apply)
      root.classList.toggle('dark', savedDark)
    }
  }, [])
}

export function LandingPage() {
  const instanceName = useAuth((s) => s.instanceName)
  const signupEnabled = useAuth((s) => s.signupEnabled)
  const setupRequired = useAuth((s) => s.setupRequired)
  useSystemTheme()

  if (setupRequired) return <Navigate to="/setup" replace />
  return <LandingContent instanceName={instanceName} signupEnabled={signupEnabled} />
}
