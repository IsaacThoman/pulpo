import type { SearchAccountSummary, SearchUsageLimit } from '@pulpo/contracts/search'
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

/** Mirrors Pulpo's compact SubscriptionUsageBar: label, percentage left, and an available/reserved bar. */
function UsageBar({ limit }: { limit: SearchUsageLimit }) {
  return (
    <div className="usage-limit">
      <div className="usage-limit-label">
        <span>{limit.label}</span>
        <span>{limit.remainingPercentage}% left</span>
      </div>
      <div className="usage-limit-track" role="progressbar" aria-label={limit.label} aria-valuenow={limit.remainingPercentage}
        aria-valuetext={`${limit.remainingPercentage}% left`} aria-valuemin={0} aria-valuemax={100}>
        <div className="usage-limit-available" style={{ width: `${limit.availableBarPercentage}%` }} />
        <div className="usage-limit-pending" style={{ width: `${limit.pendingBarPercentage}%` }} />
      </div>
    </div>
  )
}

export function AccountCredits({ account }: { account: SearchAccountSummary | undefined }) {
  if (!account) return <div className="account-credits" aria-busy="true"><span>Credits</span><span className="account-credits-value">…</span></div>
  return <>
    <div className="account-credits">
      <span>Credits</span>
      <span className="account-credits-value">{formatCredits(account.balanceMicros)}</span>
      {account.poolBalanceMicros !== null && <>
        <span>Pool</span>
        <span className="account-credits-value">{formatCredits(account.poolBalanceMicros)}</span>
      </>}
    </div>
    {account.limits.length > 0 && <div className="usage-limits">
      {account.limits.map(limit => <UsageBar key={limit.id} limit={limit} />)}
    </div>}
  </>
}

export function LimitAction({ error, account }: { error: Pick<SearchApiError, 'code'>; account: SearchAccountSummary | undefined }) {
  const destination = limitDestination(error, account)
  return <a className="secondary-button" href={destination.href}>{destination.label}</a>
}
