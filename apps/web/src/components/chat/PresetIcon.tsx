import type { ChatPresetIcon } from '@pulpo/contracts'
import { useEffect, useReducer } from 'react'
import { Circle, Icon, type IconNode } from 'lucide-react'
import { dynamicIconImports } from 'lucide-react/dynamic.js'
import { cn } from '@/lib/utils'
import { resolvePresetIconName } from './preset-icon-options'

// Keep resolved SVG data across composer remounts, not just the imported module.
const iconNodes = new Map<ChatPresetIcon, IconNode>()
const pendingIcons = new Map<ChatPresetIcon, Promise<IconNode>>()

function loadIcon(name: ChatPresetIcon): Promise<IconNode> {
  const pending = pendingIcons.get(name)
  if (pending) return pending
  const request = dynamicIconImports[name]()
    .then(({ __iconNode }) => {
      iconNodes.set(name, __iconNode)
      return __iconNode
    })
    .finally(() => pendingIcons.delete(name))
  pendingIcons.set(name, request)
  return request
}

export function PresetIcon({
  name,
  className,
}: {
  name?: ChatPresetIcon | string
  className?: string
}) {
  const resolvedName = resolvePresetIconName(name)
  const iconClassName = cn('size-3.5', className)
  const [, refresh] = useReducer((revision: number) => revision + 1, 0)

  useEffect(() => {
    if (resolvedName === 'circle') return
    if (iconNodes.has(resolvedName)) {
      refresh()
      return
    }
    let active = true
    void loadIcon(resolvedName).then(() => {
      if (active) refresh()
    }).catch((error: unknown) => {
      console.error('Unable to load preset icon', resolvedName, error)
    })
    return () => { active = false }
  }, [resolvedName])

  const iconNode = iconNodes.get(resolvedName)
  return iconNode
    ? <Icon iconNode={iconNode} className={iconClassName} />
    : <Circle className={iconClassName} />
}
