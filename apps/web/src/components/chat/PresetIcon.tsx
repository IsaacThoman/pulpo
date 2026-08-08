import {
  Brain,
  Circle,
  Flame,
  Gauge,
  Rocket,
  Sparkles,
  Timer,
  Zap,
  ZapOff,
  type LucideIcon,
} from 'lucide-react'
import type { ChatPresetIcon } from '@/lib/types'
import { cn } from '@/lib/utils'

const ICONS: Record<ChatPresetIcon, LucideIcon> = {
  brain: Brain,
  zap: Zap,
  'zap-off': ZapOff,
  gauge: Gauge,
  sparkles: Sparkles,
  rocket: Rocket,
  circle: Circle,
  flame: Flame,
  timer: Timer,
}

export function PresetIcon({
  name,
  className,
}: {
  name?: ChatPresetIcon | string
  className?: string
}) {
  const Icon = (name && ICONS[name as ChatPresetIcon]) || Circle
  return <Icon className={cn('size-3.5', className)} />
}
