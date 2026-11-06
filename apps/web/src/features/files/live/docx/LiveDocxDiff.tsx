import { useEffect, useState } from 'react'
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { diffDocxFiles, type DocxDiff } from '@pulpo/client-core/office/docx'
import { Loader2 } from 'lucide-react'
import { FileVersionsSummary } from '../FileVersionsSummary'
import type { LiveDiffProps } from '../types'
import { DocxDiffView } from './DocxDiffView'

/** An agent's change to a Word document as a redline; unreadable versions fall back to sizes. */
export function LiveDocxDiff({ name, before, after, className }: LiveDiffProps) {
  const [diff, setDiff] = useState<DocxDiff | null | 'failed'>(null)
  useEffect(() => {
    let current = true
    setDiff(null)
    // A scratch store holds the parts and picture hashes for comparison.
    diffDocxFiles(before, after, new MemoryLiveAssetStore()).then(
      (result) => { if (current) setDiff(result) },
      () => { if (current) setDiff('failed') },
    )
    return () => { current = false }
  }, [before, after])
  if (diff === 'failed') return <FileVersionsSummary name={name} before={before} after={after} className={className} />
  if (!diff) return <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  return <DocxDiffView diff={diff} className={className} />
}

export default LiveDocxDiff
