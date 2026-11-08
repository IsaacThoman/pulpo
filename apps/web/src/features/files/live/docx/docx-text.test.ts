import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { docxCodec, MemoryAssetStore } from '@pulpo/client-core/office/docx'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { docxPlainText, plainTextName } from './docx-text'

async function fixture(name: string): Promise<Y.Doc> {
  const doc = new Y.Doc()
  const bytes = readFileSync(resolve(import.meta.dirname, '../../../../../../../packages/client-core/fixtures/docx', name))
  await docxCodec.importFile(doc, new Uint8Array(bytes), { name, assets: new MemoryAssetStore() })
  return doc
}

describe('Word plain text download', () => {
  it('writes list numbers and bullets as text, one paragraph a line', async () => {
    const text = docxPlainText(await fixture('lists.docx'))
    expect(text).toMatch(/^1\.\tList Number item 1$/m)
    expect(text).toMatch(/^•\tList Bullet item 1$/m)
    expect(text).not.toMatch(/^#/m)
    expect(text.endsWith('\n')).toBe(true)
  })

  it('writes table rows as tab-separated cells, without Markdown pipes', async () => {
    const text = docxPlainText(await fixture('tables.docx'))
    expect(text).not.toContain('|')
    expect(text).toMatch(/^Grid 3,1\tGrid 3,2\tGrid 3,3$/m)
    expect(text).toMatch(/^Banded 1,1\tBanded 1,2\tBanded 1,3$/m)
    // A nested table stays inside its cell.
    expect(text).toMatch(/^Banded 2,1\tBanded 2,2 Inner 1,1/m)
  })

  it('names the download after the document', () => {
    expect(plainTextName('Report.docx')).toBe('Report.txt')
    expect(plainTextName('Notes v1.2')).toBe('Notes v1.2.txt')
    expect(plainTextName(undefined)).toBe('Document.txt')
  })
})
