import type { DataProfile } from '@pulpo/contracts'

export function DataProfileBadge({ profile }: { profile: Pick<DataProfile, 'name' | 'color'> }) {
  return <span className="grid size-7 shrink-0 place-items-center rounded-lg text-xs font-semibold text-white" style={{ backgroundColor: profile.color }}>{profile.name.slice(0, 2).toLocaleUpperCase()}</span>
}
