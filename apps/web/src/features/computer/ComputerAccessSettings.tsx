import { useCallback, useEffect, useState } from 'react'
import type { ComputerFolder } from '@pulpo/contracts'
import { Folder, SquareTerminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ui, uit } from '@/i18n/ui'
import { desktopComputerApi } from '@/lib/runtime'
import { computerPathTail } from './changes/bridge'

interface Allowed { fullAccess: boolean; folders: ComputerFolder[] }

/**
 * What the user has let the agent use on this computer, with a way to take each thing back: full
 * access and every folder picked in the folder dialog. Shown in the desktop app only, and only
 * once something was allowed. Taking something back ends the replies that are using it.
 */
export function ComputerAccessSettings() {
  const [api] = useState(desktopComputerApi)
  const [allowed, setAllowed] = useState<Allowed | null>(null)
  const refresh = useCallback(() => {
    if (!api) return
    void api.status().then((status) => setAllowed({ fullAccess: status.fullAccess, folders: status.folders })).catch(() => undefined)
  }, [api])
  useEffect(refresh, [refresh])

  if (!api || !allowed || (!allowed.fullAccess && !allowed.folders.length)) return null
  // Older desktop apps have no way to take access back; say nothing rather than offer dead buttons.
  if (typeof api.revokeFullAccess !== 'function' || typeof api.forgetFolder !== 'function') return null
  const rowClass = 'flex min-w-0 items-center justify-between gap-3 py-1.5 text-sm'
  return (
    <>
      <Separator className="my-3" />
      <section aria-labelledby="computer-access-heading" className="py-3">
        <h3 id="computer-access-heading" className="text-sm font-medium">{ui("This computer")}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{ui("What the agent may use on this computer.")}</p>
        <ul className="mt-2">
          {allowed.fullAccess && (
            <li className={rowClass}>
              <span className="flex min-w-0 items-center gap-2"><SquareTerminal className="size-4 shrink-0 opacity-70" />{ui("Full access")}</span>
              <Button variant="outline" size="sm" onClick={() => { void api.revokeFullAccess().then(refresh, refresh) }}>{ui("Turn off")}</Button>
            </li>
          )}
          {allowed.folders.map((folder) => (
            <li key={folder.path} className={rowClass}>
              <span className="flex min-w-0 items-center gap-2">
                <Folder className="size-4 shrink-0 opacity-70" />
                {/* The end of a path tells folders apart, so a long one loses its start. */}
                <span className="truncate" title={folder.path}>{computerPathTail(folder.path, 48)}</span>
              </span>
              <Button variant="outline" size="sm" aria-label={uit`Remove ${folder.name}`} onClick={() => { void api.forgetFolder(folder.path).then(refresh, refresh) }}>{ui("Remove")}</Button>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
