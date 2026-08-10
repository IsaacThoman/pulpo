import { useEffect, useState } from 'react'
import { formatChatExpiryRemaining } from '@/lib/chat-expiration'

export function ExpiryCountdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setNow(Date.now())
    const interval = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(interval)
  }, [expiresAt])

  return <>{formatChatExpiryRemaining(expiresAt, now)}</>
}
