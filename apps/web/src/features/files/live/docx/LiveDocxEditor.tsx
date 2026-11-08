import type { LiveEditorProps } from '../types'
import { sessionColor, sessionLabel } from '../../editor/presence'
import { DocxEditorView } from './DocxEditorView'

/** A Word document in Files: the docx editor on the document's session and assets. */
export function LiveDocxEditor({ session, editable, assets, toolbarSlot, fileMenu, onSaveShortcut }: LiveEditorProps) {
  return (
    <DocxEditorView
      doc={session.doc}
      awareness={session.provider.awareness}
      assets={assets}
      user={{ name: sessionLabel(), color: sessionColor(session.doc.clientID) }}
      readOnly={!editable}
      toolbarSlot={toolbarSlot}
      fileMenu={fileMenu}
      onSaveShortcut={onSaveShortcut}
    />
  )
}

export default LiveDocxEditor
