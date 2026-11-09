import type { ReactNode } from 'react'
import { ProfileAvatar } from '@/components/ProfileAvatar'

/** A profile's picture beside its name and handle; `nameAccessory` sits after the name, `children` add lines under the handle. */
export function ProfileHeading({ name, avatarUrl, username, nameAccessory, children }: {
  name: string
  avatarUrl: string | null | undefined
  username: string
  nameAccessory?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex min-w-0 items-center gap-4">
      <ProfileAvatar name={name} avatarUrl={avatarUrl} shape="circle" className="size-14" fallbackClassName="text-lg" />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <h2 className="min-w-0 text-lg font-medium wrap-anywhere">{name}</h2>
          {nameAccessory}
        </div>
        <p className="text-xs text-muted-foreground wrap-anywhere">@{username}</p>
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
