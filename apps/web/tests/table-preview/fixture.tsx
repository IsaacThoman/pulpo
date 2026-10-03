import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/i18n'
import { AttachmentPreviewDialog } from '../../src/components/chat/AttachmentPreview'

// A CSV well past the old 200K-character text cap, with quoted cells and a wide header.
const rows = Number(new URLSearchParams(location.search).get('rows') ?? 5000)
const header = ['id', 'name', 'note', ...Array.from({ length: 17 }, (_, index) => `metric_${index + 1}`)]
const lines = [header.join(',')]
for (let row = 1; row <= rows; row++) {
  lines.push([row, `row ${row}`, `"Note, with a comma ${row}"`, ...Array.from({ length: 17 }, (_, index) => (row * (index + 1)) % 997)].join(','))
}
const text = lines.join('\n')
const file = new File([text], 'big.csv', { type: 'text/csv' })

// StrictMode double-invokes state initializers; the first batch must still start at row 1.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AttachmentPreviewDialog
      attachment={{ id: 'big.csv', name: 'big.csv', mimeType: 'text/csv', type: 'file', size: file.size }}
      sourceFile={file}
      open
      onOpenChange={() => undefined}
      onDownload={() => undefined}
    />
  </StrictMode>,
)
