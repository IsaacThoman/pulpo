import type { DocSession } from '@pulpo/client-core/doc-sync'
import type { LiveAssetStore } from '@pulpo/client-core/office'

/** What Files hands a live format's editor. */
export interface LiveEditorProps {
  session: DocSession
  /** The file name; its extension may refine the editor (a language, a preview). */
  name: string
  editable: boolean
  /** `narrow` and `wide` follow the chat width preference; `fill` is the side panel. */
  width: 'narrow' | 'wide' | 'fill'
  /** Rendered at the end of the editor's toolbar. */
  toolbarSlot?: React.ReactNode
  /** The document's binary parts (pictures, preserved file parts). */
  assets: LiveAssetStore
}

/** Two versions of a file for a review diff: before and after an agent's change. */
export interface LiveDiffProps {
  name: string
  before: Uint8Array
  after: Uint8Array
  className?: string
}
