import { HardDrive } from 'lucide-react'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { uit } from '@/i18n/ui'
import { FileNodeIcon } from './FileNodeIcon'
import { useOpenFileOffer } from './open-file-offer'

/** The composer's add menu entry for the open file, so it is one click away. */
export function OpenFileMenuItem({ selected, onAdd }: { selected: readonly string[]; onAdd: (ids: string[]) => void }) {
  const offer = useOpenFileOffer(selected)
  if (!offer) return null
  return (
    <>
      <DropdownMenuItem className="max-w-72" onSelect={() => onAdd([offer.id])}>
        {offer.node ? <FileNodeIcon node={offer.node} /> : <HardDrive className="text-muted-foreground" />}
        <span className="min-w-0 truncate">{uit`Add ${offer.name}`}</span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  )
}
