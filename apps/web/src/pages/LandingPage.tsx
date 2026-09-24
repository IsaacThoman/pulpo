import { Navigate } from 'react-router-dom'
import { useAuth } from '@/stores/auth'
import { LandingContent } from './LandingContent'

export function LandingPage() {
  const instanceName = useAuth((s) => s.instanceName)
  const signupEnabled = useAuth((s) => s.signupEnabled)
  const setupRequired = useAuth((s) => s.setupRequired)

  if (setupRequired) return <Navigate to="/setup" replace />
  return <LandingContent instanceName={instanceName} signupEnabled={signupEnabled} />
}
