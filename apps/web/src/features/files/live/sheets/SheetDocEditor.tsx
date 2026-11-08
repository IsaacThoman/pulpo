import { sheetFormatOf } from '@pulpo/client-core/office/sheets'
import { sessionColor, sessionLabel } from '../../editor/presence'
import type { LiveEditorProps } from '../types'
import { SheetEditor } from './SheetEditor'

/** A spreadsheet in Files: the shared editor bound to the document's session. */
export function SheetDocEditor({ session, editable, toolbarSlot, assets, name, fileMenu, onSaveShortcut }: LiveEditorProps) {
  return (
    <SheetEditor
      doc={session.doc}
      awareness={session.provider.awareness}
      readOnly={!editable}
      fileFormat={sheetFormatOf(name)}
      assets={assets}
      user={{ name: sessionLabel(), color: sessionColor(session.doc.clientID) }}
      toolbarSlot={toolbarSlot}
      name={name}
      fileMenu={fileMenu}
      onSaveShortcut={onSaveShortcut}
    />
  )
}

export default SheetDocEditor
