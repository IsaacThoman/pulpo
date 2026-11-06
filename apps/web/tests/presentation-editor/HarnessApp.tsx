import { useState } from 'react'
import type * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import type { LiveAssetStore } from '@pulpo/client-core/office'
import { diffDocuments } from '@pulpo/client-core/office/presentation'
import type { PresentationController } from '@pulpo/client-core/office/presentation/view'
import { PresentationDiffView } from '../../src/features/files/live/presentation/PresentationDiffView'
import { PresentationEditor } from '../../src/features/files/live/presentation/PresentationEditor'

/** The harness page: one editor (or two side by side), or the review diff against the opened file. */
export function HarnessApp({ name, original, docA, docB, awarenessA, awarenessB, assets, controllers, params }: {
  name: string
  original: Y.Doc
  docA: Y.Doc
  docB: Y.Doc
  awarenessA: Awareness
  awarenessB: Awareness
  assets: LiveAssetStore
  controllers: { a?: PresentationController; b?: PresentationController }
  params: URLSearchParams
}) {
  const [view, setView] = useState(params.get('view') === 'diff' ? 'diff' : 'editor')
  const readOnly = params.get('readonly') === '1'
  const split = params.get('split') === '1'
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex items-center gap-2 border-b px-3 py-1 text-xs text-muted-foreground">
        <span>{name}</span>
        <button type="button" className="ml-auto rounded border px-2 py-0.5" onClick={() => setView(view === 'diff' ? 'editor' : 'diff')}>
          {view === 'diff' ? 'Editor' : 'Changes'}
        </button>
      </div>
      {view === 'diff' ? (
        <div className="min-h-0 flex-1 overflow-auto p-4">
          <PresentationDiffView diff={diffDocuments(original, docA)} beforeAssets={assets} />
        </div>
      ) : (
        <div className={split ? 'grid min-h-0 flex-1 grid-cols-2 divide-x' : 'flex min-h-0 flex-1'}>
          <PresentationEditor
            className="min-w-0 flex-1"
            doc={docA}
            awareness={awarenessA}
            readOnly={readOnly}
            assets={assets}
            user={{ name: 'Ada', color: '#2f6fed' }}
            startInShow={name.endsWith('.ppsx') && params.get('show') !== '0'}
            onReady={(controller) => (controllers.a = controller)}
          />
          {split && (
            <PresentationEditor className="min-w-0" doc={docB} awareness={awarenessB} readOnly={readOnly} assets={assets} user={{ name: 'Grace', color: '#d9480f' }} onReady={(controller) => (controllers.b = controller)} />
          )}
        </div>
      )}
    </div>
  )
}

