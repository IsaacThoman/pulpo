import type { ReactNode } from 'react'
import { ProfileAvatar } from '@/components/ProfileAvatar'

/** A profile's picture beside its name and handle; `handleAccessory` sits after the handle, `children` add lines under it. */
export function ProfileHeading({ name, avatarUrl, username, handleAccessory, children }: {
  name: string
  avatarUrl: string | null | undefined
  username: string
  handleAccessory?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex min-w-0 items-center gap-4">
      <ProfileAvatar name={name} avatarUrl={avatarUrl} shape="circle" className="size-14" fallbackClassName="text-lg" />
      <div className="min-w-0">
        <h2 className="text-lg font-medium wrap-anywhere">{name}</h2>
        {/* The accessory sits a space-width from the handle so it reads as part of it. */}
        <div className="flex min-w-0 items-center gap-0.5">
          <p className="min-w-0 text-xs text-muted-foreground wrap-anywhere">@{username}</p>
          {handleAccessory}
        </div>
        {children}
      </div>
    </div>
  )
}

/** The profile header row: identity on the left, account details or actions on the right. */
export function ProfileHeaderRow({ identity, aside }: { identity: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      {identity}
      {aside && <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:gap-6">{aside}</div>}
    </div>
  )
}
