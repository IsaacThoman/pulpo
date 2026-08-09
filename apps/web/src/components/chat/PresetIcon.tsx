import type { ChatPresetIcon } from '@pulpo/contracts'
import { Circle } from 'lucide-react'
import { DynamicIcon } from 'lucide-react/dynamic.js'
import { cn } from '@/lib/utils'
import { resolvePresetIconName } from './preset-icon-options'

export function PresetIcon({
  name,
  className,
}: {
  name?: ChatPresetIcon | string
  className?: string
}) {
  const resolvedName = resolvePresetIconName(name)
  const iconClassName = cn('size-3.5', className)
  const Fallback = () => <Circle className={iconClassName} />
  return <DynamicIcon name={resolvedName} fallback={Fallback} className={iconClassName} />
}
