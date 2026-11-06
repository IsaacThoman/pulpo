import { useEffect, useState } from 'react'
import { MemoryLiveAssetStore } from '@pulpo/client-core/office'
import { diffSnapshots, readPresentation, type PresentationDiff } from '@pulpo/client-core/office/presentation'
import { Loader2 } from 'lucide-react'
import { FileVersionsSummary } from '../FileVersionsSummary'
import type { LiveDiffProps } from '../types'
import { PresentationDiffView } from './PresentationDiffView'

interface Compared {
  diff: PresentationDiff
  before: MemoryLiveAssetStore
  after: MemoryLiveAssetStore
}

/** Reads both versions (with their images) into scratch asset stores and compares them. */
async function compare(before: Uint8Array, after: Uint8Array): Promise<Compared> {
  const stores = { before: new MemoryLiveAssetStore(), after: new MemoryLiveAssetStore() }
  const [left, right] = await Promise.all([readPresentation(before, { assets: stores.before }), readPresentation(after, { assets: stores.after })])
  return { diff: diffSnapshots(left, right), ...stores }
}

/** An agent's proposed deck against the current one: changed slides with thumbnails and text diffs. */
export function PresentationFileDiff({ name, before, after, className }: LiveDiffProps) {
  const [state, setState] = useState<{ result?: Compared; failed?: boolean }>({})
  useEffect(() => {
    let cancelled = false
    setState({})
    compare(before, after).then(
      (result) => !cancelled && setState({ result }),
      () => !cancelled && setState({ failed: true }),
    )
    return () => {
      cancelled = true
    }
  }, [before, after])
  if (state.failed) return <FileVersionsSummary name={name} before={before} after={after} className={className} />
  if (!state.result) return <div className="grid h-32 place-items-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
  return (
    <div className={className}>
      <PresentationDiffView diff={state.result.diff} beforeAssets={state.result.before} afterAssets={state.result.after} />
    </div>
  )
}

export default PresentationFileDiff
