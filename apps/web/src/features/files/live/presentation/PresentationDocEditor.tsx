import { sessionColor, sessionLabel } from '../../editor/presence'
import type { LiveEditorProps } from '../types'
import { PresentationEditor } from './PresentationEditor'

/**
 * A presentation opened from Files: the editor on the document's shared session, with its
 * collaborators' presence, and `.ppsx` slideshows starting in the show.
 */
export function PresentationDocEditor({ session, name, editable, toolbarSlot, assets }: LiveEditorProps) {
  return (
    <PresentationEditor
      doc={session.doc}
      awareness={session.provider.awareness}
      readOnly={!editable}
      assets={assets}
      user={{ name: sessionLabel(), color: sessionColor(session.doc.clientID) }}
      startInShow={/\.pps[xm]$/i.test(name)}
      toolbarSlot={toolbarSlot}
    />
  )
}

export default PresentationDocEditor
