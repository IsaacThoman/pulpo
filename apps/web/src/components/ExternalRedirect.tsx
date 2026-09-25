import { useEffect } from 'react'

export function ExternalRedirect({ to }: { to: string }) {
  useEffect(() => { window.location.replace(to) }, [to])
  return null
}
