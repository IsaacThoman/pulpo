import { useEffect, useState } from 'react'
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { diffSheetFiles, type WorkbookDiff } from '@pulpo/client-core/office/sheets'
import { Loader2 } from 'lucide-react'
import { FileVersionsSummary } from '../FileVersionsSummary'
import type { LiveDiffProps } from '../types'
import { SheetDiff } from './SheetDiff'

/** An agent's proposed change to a spreadsheet, cell by cell. */
export function SheetFileDiff({ name, before, after, className }: LiveDiffProps) {
  const [diff, setDiff] = useState<WorkbookDiff | null | undefined>()
  useEffect(() => {
    let cancelled = false
    setDiff(undefined)
    // Pictures and preserved parts only matter for export, so a scratch store is enough.
    diffSheetFiles(before, after, { name, assets: new MemoryLiveAssetStore() }).then(
      (result) => !cancelled && setDiff(result),
      () => !cancelled && setDiff(null),
    )
    return () => {
      cancelled = true
    }
  }, [name, before, after])
  if (diff === undefined) return <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  // A version the codec can't open (damaged, encrypted) still shows its sizes.
  if (diff === null) return <FileVersionsSummary name={name} before={before} after={after} className={className} />
  return <SheetDiff diff={diff} className={className} />
}

export default SheetFileDiff
