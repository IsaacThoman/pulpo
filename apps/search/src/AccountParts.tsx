import type { SearchAccountSummary } from '@pulpo/contracts/search'
import { useState } from 'react'
import { formatCredits, initials, limitDestination } from './account'
import type { SearchApiError, SearchUser } from './api'

/** Matches Pulpo's profile picture, with the same initials fallback. */
export function AccountAvatar({ user }: { user: SearchUser }) {
  const [failed, setFailed] = useState<string>()
  const label = user.name || user.email || 'Pulpo account'
  const image = user.avatarUrl && failed !== user.avatarUrl ? user.avatarUrl : undefined
  return (
    <span className="account-avatar" aria-hidden="true">
      {image
        ? <img src={image} alt="" onError={() => setFailed(image)} />
        : <span className="account-avatar-fallback">{initials(label)}</span>}
    </span>
  )
}

export function AccountCredits({ account }: { account: SearchAccountSummary | undefined }) {
  if (!account) return <div className="account-credits" aria-busy="true"><span>Credits</span><span className="account-credits-value">…</span></div>
  const weekly = account.weeklyRemainingPercentage
  return (
    <div className="account-credits">
      <span>Credits</span>
      <span className="account-credits-value">{formatCredits(account.balanceMicros)}</span>
      {account.poolBalanceMicros !== null && <>
        <span>Pool</span>
        <span className="account-credits-value">{formatCredits(account.poolBalanceMicros)}</span>
      </>}
      {weekly !== null && <>
        <span>Weekly plan</span>
        <span className="account-credits-value">{Math.round(weekly)}% left</span>
      </>}
    </div>
  )
}

export function LimitAction({ error, account }: { error: Pick<SearchApiError, 'code'>; account: SearchAccountSummary | undefined }) {
  const destination = limitDestination(error, account)
  return <a className="secondary-button" href={destination.href}>{destination.label}</a>
}
