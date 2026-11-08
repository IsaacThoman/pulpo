// Run with: npm run test:docx-editor -w @pulpo/web (build @pulpo/client-core first)
// Install the browser once with: npx playwright install chromium
// Set SCREENSHOT_DIR to also save screenshots (light and dark).
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import * as Y from 'yjs'
import { unzipSync } from 'fflate'
import { docxCodec, readDocxModel, MemoryAssetStore } from '@pulpo/client-core/office/docx'

const root = new URL('..', import.meta.url).pathname
const screenshots = process.env.SCREENSHOT_DIR
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
let server
let browser
const results = []
let current
const step = async (name, run) => {
  const started = Date.now()
  try {
    await run()
  } catch (error) {
    if (process.env.FAILURE_SCREENSHOT) await current?.screenshot({ path: process.env.FAILURE_SCREENSHOT })
    throw new Error(`${name}: ${error.message}`, { cause: error })
  }
  results.push(`${name} (${Date.now() - started} ms)`)
}

try {
  server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  browser = await chromium.launch()
  const base = `${server.resolvedUrls.local[0]}tests/docx-editor/index.html`
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  current = page
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const open = async (query) => {
    await page.goto(`${base}${query}`)
    await page.waitForFunction(() => window.harness?.ready && window.harness.editors[0]?.pages >= 1, null, { timeout: 30_000 })
    await page.waitForTimeout(300)
  }
  const flow = page.locator('.docx-flow.ProseMirror').first()
  const text = () => page.evaluate(() => window.harness.text())
  const paragraph = (contains) => flow.locator('p.docx-p', { hasText: contains }).first()
  /** Puts the caret at the end of the first paragraph containing `contains` (End scrolls on macOS). */
  const clickEnd = async (contains, editorIndex = 0, back = 0) => {
    // A real click first: the page only takes keys after a user gesture.
    await page.locator('.docx-flow.ProseMirror').nth(editorIndex).locator('p.docx-p', { hasText: contains }).first().click()
    await page.evaluate(({ contains, editorIndex, back }) => {
      const view = window.harness.editors[editorIndex].view
      let target
      view.state.doc.descendants((node, pos) => {
        if (target === undefined && node.type.name === 'paragraph' && node.textContent.includes(contains)) target = pos + node.nodeSize - 1
        return target === undefined
      })
      const Selection = view.state.selection.constructor
      // Focus first: focusing moves the browser's selection, which ProseMirror would read back.
      view.focus()
      view.dispatch(view.state.tr.setSelection(Selection.create(view.state.doc, target - back, target)))
    }, { contains, editorIndex, back })
  }
  const exported = async (kind) => {
    const base64 = await page.evaluate(() => window.harness.exportFile())
    const doc = new Y.Doc()
    await docxCodec.importFile(doc, new Uint8Array(Buffer.from(base64, 'base64')), { name: 'a.docx', assets: new MemoryAssetStore() })
    return kind ? [...readDocxModel(doc).stories.values()].filter((story) => story.meta.kind === kind).map((story) => story.doc.textContent).join("\n") : docxCodec.toText(doc)
  }

  await step('loads a document into pages with headers and fields', async () => {
    await open('?file=sections-headers.docx')
    assert.ok(await page.locator('.docx-page').count() >= 2)
    await page.locator('.docx-story', { hasText: 'First-page header' }).waitFor()
    await page.locator('.docx-story', { hasText: /page i of \d/ }).first().waitFor()
  })

  await step('renders normalized header/footer targets and section page fields in screen and print layouts', async () => {
    await open('?file=sections-headers.docx')
    const keys = await page.evaluate(() => {
      const editor = window.harness.editors[0]
      const doc = editor.options.doc
      const schema = editor.view.state.schema
      const refs = []
      const keys = []
      const simple = (code) => schema.text('999', [schema.mark('fldSimple', { v: JSON.stringify(['w:fldSimple', { 'w:instr': code }, '\u0000']) })])
      const field = (type) => schema.node('fieldChar', { charType: type, v: JSON.stringify(['w:fldChar', { 'w:fldCharType': type }]) })
      const content = [simple('PAGE'), schema.text('/'), simple('NUMPAGES'), schema.text('/'),
        field('begin'), schema.node('fieldCode', { v: JSON.stringify(['w:instrText', {}, ' SECTIONPAGES ']) }), field('separate'), schema.text('999'), field('end'),
        schema.text('/'), simple('SECTIONPAGES \\* ROMAN')]
      for (const kind of ['header', 'footer']) {
        const [key, json] = [...doc.getMap('stories')].find(([, json]) => JSON.parse(json).kind === kind)
        const [id, relJson] = [...doc.getMap('rels')].find(([, json]) => JSON.parse(json).type.endsWith(`/${kind}`))
        doc.getMap('rels').set(id, JSON.stringify({ ...JSON.parse(relJson), target: `../${JSON.parse(json).part}` }))
        for (const type of ['default', 'even']) refs.push([`w:${kind}Reference`, { 'w:type': type, 'r:id': id }])
        keys.push(key)
        editor.openStoryEditor(key)
        const view = editor.storyEditor.view
        view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, schema.node('paragraph', null, content)))
        editor.closeStoryEditor()
      }
      const first = JSON.stringify(['w:sectPr', {}, ...refs, ['w:pgNumType', { 'w:start': '1', 'w:fmt': 'lowerRoman' }]])
      doc.getMap('docx').set('sectPr', JSON.stringify(['w:sectPr', {}, ['w:pgNumType', { 'w:start': '5' }]]))
      const p = (text, attrs) => schema.node('paragraph', attrs, schema.text(text))
      const view = editor.view
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, [p('First page'), p('Second page', { pageBreakBefore: JSON.stringify(['w:pageBreakBefore', {}]), sectPr: first }), p('New section')]))
      editor.relayout()
      return keys
    })
    assert.equal(await page.evaluate(() => window.harness.editors[0].pages), 3)
    const expected = ['i/3/2/II', 'ii/3/2/II', '5/3/1/I']
    const texts = (key) => page.locator(`[data-story="${key}"]`).allInnerTexts()
    for (const key of keys) assert.deepEqual((await texts(key)).map((text) => text.trim()), expected)
    await page.emulateMedia({ media: 'print' })
    for (const key of keys) assert.deepEqual((await texts(key)).map((text) => text.trim()), expected)
    await page.emulateMedia({ media: 'screen' })
    for (const key of keys) {
      await page.locator(`[data-story="${key}"]`).last().dblclick()
      await page.keyboard.type('Edited ')
      assert.equal(await page.evaluate(() => window.harness.editors[0].editingStory), key)
      await page.keyboard.press('Escape')
    }
    assert.match(await exported('header'), /Edited /)
    assert.match(await exported('footer'), /Edited /)
    await open('?file=sections-headers.docx')
  })

  await step('edits a populated header in place and exports it', async () => {
    await page.locator('.docx-band .docx-story', { hasText: 'First-page header' }).first().dblclick()
    const story = page.locator('.docx-story-editor')
    await story.waitFor()
    await page.keyboard.type('Header edit regression ')
    await page.keyboard.press('Escape')
    await story.waitFor({ state: 'detached' })
    assert.match(await exported('header'), /Header edit regression/)
    assert.deepEqual(errors, [])
  })

  await step('repaginates local story edits, keeps static lists, and searches only the active story', async () => {
    await open('?file=sections-headers.docx')
    const before = await page.evaluate(() => {
      const editor = window.harness.editors[0]
      return { body: JSON.stringify(editor.view.state.doc.toJSON()), top: editor.lastLayout.pages[0].setup.top }
    })
    await page.locator('.docx-band .docx-story', { hasText: 'First-page header' }).first().dblclick()
    await page.waitForFunction(() => document.querySelector('button[aria-label="Comment"]')?.disabled)
    await page.evaluate(() => window.harness.editors[0].toggleList('decimal'))
    for (let index = 0; index < 7; index++) {
      await page.keyboard.type(`Local header paragraph ${index} `)
      if (index < 6) await page.keyboard.press('Enter')
    }
    await page.waitForFunction(() => {
      const editor = window.harness.editors[0]
      return editor.root.querySelector('[data-story="' + editor.editingStory + '"]')?.textContent.includes('Local header paragraph 6')
    })
    assert.equal(await page.evaluate(({ body, top }) => {
      const editor = window.harness.editors[0]
      const staticStory = editor.root.querySelector('[data-story="' + editor.editingStory + '"]')
      return JSON.stringify(editor.view.state.doc.toJSON()) === body && editor.lastLayout.pages[0].setup.top > top &&
        staticStory.querySelectorAll('[data-label]').length >= 7 && editor.hasFocus
    }, before), true)
    await page.keyboard.press(`${mod}+f`)
    await page.getByRole('textbox', { name: 'Find in document' }).fill('Local header paragraph')
    await page.waitForFunction(() => window.harness.editors[0].findState().count === 7)
    assert.equal(await page.evaluate(() => window.harness.editors[0].replaceAll('Replaced header', 'Local header paragraph')), 7)
    assert.equal(await page.evaluate((body) => JSON.stringify(window.harness.editors[0].view.state.doc.toJSON()) === body, before.body), true)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    assert.match(await exported('header'), /Replaced header 6/)
    assert.deepEqual(errors, [])
  })

  await step('keeps a header focused and positioned while a collaborator repaginates the body', async () => {
    await open('?file=sections-headers.docx&view=split')
    await page.locator('.docx-band .docx-story', { hasText: 'First-page header' }).first().dblclick()
    await page.keyboard.type('Before layout ')
    const selection = await page.evaluate(() => {
      const editor = window.harness.editors[0]
      const view = editor.storyEditor.view
      window.activeStoryView = view
      const other = window.harness.editors[1].view
      other.dispatch(other.state.tr.insertText('Collaborator body edit ', 1))
      editor.relayout()
      return { from: view.state.selection.from, to: view.state.selection.to }
    })
    await page.waitForTimeout(250)
    assert.equal(await page.evaluate(({ from, to }) => {
      const editor = window.harness.editors[0]
      const view = editor.storyEditor.view
      const anchor = editor.root.querySelector('[data-story="' + editor.editingStory + '"]')
      const surface = view.dom.getBoundingClientRect()
      const target = anchor.getBoundingClientRect()
      return view === window.activeStoryView && view.dom.isConnected && view.hasFocus() &&
        view.state.selection.from === from && view.state.selection.to === to &&
        Math.abs(surface.left - target.left) < 2 && Math.abs(surface.top - target.top) < 2 && Math.abs(surface.width - target.width) < 2
    }, selection), true)
    await page.keyboard.type('After layout ')
    await page.keyboard.press('Escape')
    assert.match(await exported('header'), /Before layout After layout /)
    assert.deepEqual(errors, [])
  })

  await step('reviews header suggestions and immediately enforces read-only in an open story', async () => {
    await open('?file=sections-headers.docx')
    await page.evaluate(() => window.harness.editors[0].setMode('suggesting'))
    await page.locator('.docx-band .docx-story', { hasText: 'First-page header' }).first().dblclick()
    const story = page.locator('.docx-story-editor')
    await page.keyboard.type('Header suggestion ')
    const revisions = await page.evaluate(() => window.harness.editors[0].revisions())
    assert.ok(revisions.some((revision) => revision.storyId?.startsWith('header:') && revision.text.includes('Header suggestion')))
    await page.getByRole('button', { name: 'Review changes', exact: true }).click()
    const card = page.locator('[data-docx-review] article', { hasText: 'Header suggestion' }).first()
    await card.getByText('Header', { exact: true }).waitFor()
    await card.locator('button').first().click()
    await story.waitFor()
    await page.evaluate(() => window.harness.editors[0].acceptAll())
    assert.equal(await page.evaluate(() => window.harness.editors[0].revisions().length), 0)
    const before = await story.textContent()
    await page.evaluate(() => window.harness.editors[0].setReadOnly(true))
    assert.equal(await story.getAttribute('contenteditable'), 'false')
    await page.keyboard.type('Forbidden story edit')
    assert.equal(await story.textContent(), before)
    assert.doesNotMatch(await exported('header'), /Forbidden story edit/)
    assert.match(await exported('header'), /Header suggestion/)
  })

  await step('disables table column and cell structure changes while suggesting', async () => {
    await open('?file=tables.docx')
    await flow.locator('td p').first().click()
    await page.evaluate(() => window.harness.editors[0].setMode('suggesting'))
    const result = await page.evaluate(() => {
      const editor = window.harness.editors[0]
      return ['addColumnBefore', 'addColumnAfter', 'deleteColumn', 'mergeCells', 'splitCell'].map((command) => editor[command]())
    })
    assert.deepEqual(result, [false, false, false, false, false])
    await page.getByRole('button', { name: 'Table', exact: true }).click()
    for (const name of ['Insert column left', 'Insert column right', 'Delete column', 'Merge cells', 'Split cell']) {
      assert.equal(await page.getByRole('menuitem', { name, exact: true }).getAttribute('data-disabled'), '')
    }
    await page.keyboard.press('Escape')
  })

  await step('refuses section breaks while suggesting and disables their Insert menu', async () => {
    await open('?file=sections-headers.docx')
    const result = await page.evaluate(() => {
      const editor = window.harness.editors[0]
      editor.setMode('suggesting')
      const before = JSON.stringify(window.harness.model())
      const section = window.harness.docs[0].getMap('docx').get('sectPr')
      const commands = ['nextPage', 'continuous', 'evenPage', 'oddPage'].map((type) => editor.insertSectionBreak(type))
      return { commands, unchanged: before === JSON.stringify(window.harness.model()), sectionUnchanged: section === window.harness.docs[0].getMap('docx').get('sectPr'), editable: editor.state().untrackedFormattingEditable }
    })
    assert.deepEqual(result, { commands: [false, false, false, false], unchanged: true, sectionUnchanged: true, editable: false })
    await page.getByRole('button', { name: 'Insert', exact: true }).click()
    assert.equal(await page.getByRole('menuitem', { name: 'Section break', exact: true }).getAttribute('data-disabled'), '')
    await page.keyboard.press('Escape')
  })

  await step('types, formats with shortcuts, and undoes', async () => {
    await open('?file=basic-formatting.docx')
    if (screenshots) await page.screenshot({ path: `${screenshots}/docx-editor-light.png` })
    await clickEnd('A normal paragraph with plain text')
    await page.keyboard.type(' Typed here.')
    assert.match(await text(), /typographic samples below\. Typed here\./)
    await clickEnd('Typed here.', 0, 5)
    await page.keyboard.press(`${mod}+b`)
    await flow.locator('span[style*="font-weight: 700"]', { hasText: 'here' }).first().waitFor()
    await page.waitForTimeout(700)
    await page.keyboard.press(`${mod}+z`)
    await page.waitForFunction(() => ![...document.querySelectorAll('.docx-flow span[style*="font-weight: 700"]')].some((span) => span.textContent?.includes('here.')))
    assert.match(await exported(), /Typed here\./)
  })

  await step('applies styles, alignment, and lists from the toolbar', async () => {
    await paragraph('Left alignment.').click()
    await page.getByRole('button', { name: 'Style' }).click()
    await page.getByRole('menuitem', { name: 'Heading 2', exact: true }).click()
    await flow.locator('p.docx-ps-Heading2', { hasText: 'Left alignment.' }).waitFor()
    await page.getByRole('button', { name: 'Center' }).click()
    await flow.locator('p[style*="text-align: center"]', { hasText: 'Left alignment.' }).waitFor()
    await page.getByRole('button', { name: 'Numbered list' }).click()
    await flow.locator('p[data-label="1."]', { hasText: 'Left alignment.' }).waitFor()
    await page.keyboard.press('Tab')
    await flow.locator('p[data-label="a."]', { hasText: 'Left alignment.' }).waitFor()
    await page.keyboard.press('Shift+Tab')
    await flow.locator('p[data-label="1."]', { hasText: 'Left alignment.' }).waitFor()
  })

  await step('inserts and edits a table', async () => {
    await clickEnd('Line spacing single')
    await page.getByRole('button', { name: 'Insert', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Table', exact: true }).hover()
    await page.getByRole('button', { name: '2 by 3 table' }).click()
    const table = flow.locator('table.docx-table').last()
    await page.keyboard.type('Cell A')
    await page.keyboard.press('Tab')
    await page.keyboard.type('Cell B')
    assert.equal(await table.locator('td.docx-cell:not([data-phantom])').count(), 6)
    await page.getByRole('button', { name: 'Table', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Insert row below' }).click()
    assert.equal(await table.locator('tr').count(), 3)
    assert.match(await exported(), /\| Cell A \| Cell B \|/)
  })

  await step('pastes from Word and web pages without scripts', async () => {
    await clickEnd('Line spacing 1.5')
    await page.keyboard.press('Enter')
    await page.evaluate(() => {
      const data = new DataTransfer()
      data.setData('text/html', '<p><b>Pasted bold</b> and <i>italic</i><script>window.pwned = 1</script><img src=x onerror="window.pwned=2"></p><ul><li>First item</li><li>Second item</li></ul>')
      data.setData('text/plain', 'Pasted bold and italic')
      document.querySelector('.docx-flow.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    })
    await flow.locator('span[style*="font-weight: 700"]', { hasText: 'Pasted bold' }).waitFor()
    await flow.locator('p[data-label]', { hasText: 'Second item' }).waitFor()
    assert.equal(await page.evaluate(() => window.pwned), undefined)
  })

  await step('copies and pastes within Pulpo exactly, and drops what another document refers to', async () => {
    // Character spacing does not survive HTML; it does survive a Pulpo copy.
    const html = await page.evaluate(() => {
      const view = window.harness.editors[0].view
      let from
      view.state.doc.descendants((node, pos) => {
        if (from === undefined && node.isText && node.text.startsWith('Expanded character spacing')) from = pos
        return from === undefined
      })
      const Selection = view.state.selection.constructor
      view.focus()
      view.dispatch(view.state.tr.setSelection(Selection.create(view.state.doc, from, from + 'Expanded character spacing'.length)))
      const data = new DataTransfer()
      view.dom.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
      return data.getData('text/html')
    })
    assert.match(html, /data-docx-copy="[0-9a-f]{32}"/)
    assert.doesNotMatch(html, /w:spacing/)
    const pasteHtml = (markup) => page.evaluate((markup) => {
      const data = new DataTransfer()
      data.setData('text/html', markup)
      data.setData('text/plain', 'pasted')
      document.querySelector('.docx-flow.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, markup)
    await clickEnd('Line spacing double')
    await page.keyboard.press('Enter')
    await pasteHtml(html)
    const spaced = () => page.evaluate(() => {
      let count = 0
      window.harness.editors[0].view.state.doc.descendants((node) => {
        if (node.isText && node.text.includes('Expanded character spacing') && node.marks.some((mark) => mark.type.name === 'spacing')) count++
      })
      return count
    })
    assert.equal(await spaced(), 2)

    // A copy from another document (another tab, through local storage) with a picture this one
    // has no asset for, and a footnote it does not have.
    const id = 'c0'.repeat(16)
    await page.evaluate((id) => {
      const drawing = JSON.stringify(['wp:inline', {}, ['wp:extent', { cx: '952500', cy: '952500' }], ['wp:docPr', { id: '1', name: 'Picture' }]])
      const slice = { content: [{ type: 'paragraph', content: [{ type: 'text', text: 'From another document ' }, { type: 'drawing', attrs: { v: drawing, src: 'f'.repeat(64) } }, { type: 'noteRef', attrs: { kind: 'footnote', id: '999' } }] }], openStart: 1, openEnd: 1 }
      localStorage.setItem('pulpo-docx-copy', JSON.stringify({ id, json: JSON.stringify(slice), origin: 'another:body', at: Date.now() }))
    }, id)
    await page.keyboard.press('Enter')
    await pasteHtml(`<p data-docx-copy="${id}">Plain HTML fallback</p>`)
    await paragraph('From another document').waitFor()
    assert.equal(await flow.locator('p', { hasText: 'Plain HTML fallback' }).count(), 0)
    await page.waitForFunction(() => {
      let refs = 0
      window.harness.editors[0].view.state.doc.descendants((node) => {
        if ((node.type.name === 'drawing' && node.attrs.src === 'f'.repeat(64)) || (node.type.name === 'noteRef' && node.attrs.id === '999')) refs++
      })
      return refs === 0
    })
    assert.match(await exported(), /From another document/)
  })

  await step('finds and replaces', async () => {
    await flow.click()
    await page.keyboard.press(`${mod}+h`)
    await page.getByRole('textbox', { name: 'Find in document' }).fill('alignment')
    await page.getByText(/^1 of \d+$/).waitFor()
    await page.getByRole('textbox', { name: 'Replace with' }).fill('ALIGNMENT')
    await page.getByRole('button', { name: 'Replace all' }).click()
    assert.doesNotMatch(await text(), /alignment/)
    assert.match(await text(), /Right ALIGNMENT\./)
    await page.keyboard.press('Escape')
  })

  await step('comments on a selection and exports the comment', async () => {
    await paragraph('Hanging indent.').dblclick()
    await page.getByRole('button', { name: 'Comment', exact: true }).first().click()
    await page.getByRole('textbox', { name: 'New comment' }).fill('Please tighten this.')
    await page.getByRole('button', { name: 'Comment', exact: true }).last().click()
    await page.locator('[data-comment]', { hasText: 'Please tighten this.' }).waitFor()
    await flow.locator('.docx-comment-range').first().waitFor()
    assert.match(await exported(), /\[comment \d+ Ada on "Hanging"\]: Please tighten this\./)
  })

  await step('keeps comment creation and deletion outside text undo', async () => {
    const result = await page.evaluate(() => {
      const editor = window.harness.editors[0]
      const view = editor.view
      const markers = (id) => {
        let count = 0
        view.state.doc.descendants((node) => { if (node.type.name === 'commentMark' && node.attrs.id === id) count++ })
        return count
      }
      const id = editor.addComment('Undo-safe comment')
      editor.undo()
      const added = { exists: editor.comments().some((thread) => thread.id === id), markers: markers(id) }
      editor.redo()
      editor.deleteComment(id)
      editor.undo()
      const deleted = { exists: editor.comments().some((thread) => thread.id === id), markers: markers(id) }
      editor.redo()
      return { added, deleted }
    })
    assert.deepEqual(result, { added: { exists: true, markers: 3 }, deleted: { exists: false, markers: 0 } })
  })

  await step('inserts PNG pictures and refuses SVG, which Word would not show', async () => {
    await paragraph('Hanging indent.').click()
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    const before = await flow.locator('.docx-drawing').count()
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
    assert.equal(await page.evaluate(async (bytes) => window.harness.editors[0].insertImage(new Blob([new Uint8Array(bytes)], { type: 'image/svg+xml' })), [...svg]), false)
    // TIFF (or anything else that is not PNG, JPEG, GIF, or BMP) is refused too, whatever its type says.
    assert.equal(await page.evaluate(() => window.harness.editors[0].insertImage(new Blob([new Uint8Array([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0])], { type: 'image/png' }))), false)
    await page.locator('input[type=file][accept^="image/"]').setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: png })
    await page.waitForFunction((count) => document.querySelectorAll('.docx-flow .docx-drawing').length > count, before)
    assert.match(await page.locator('input[type=file][accept^="image/"]').getAttribute('accept'), /^image\/png,image\/jpeg,image\/gif,image\/bmp$/)
  })

  await step('suggests changes as tracked revisions and accepts them', async () => {
    await page.getByRole('button', { name: 'Editing mode' }).click()
    await page.getByRole('menuitem', { name: /Suggesting/ }).click()
    await clickEnd('Expanded character spacing')
    await page.keyboard.type(' suggested')
    await flow.locator('ins.docx-ins', { hasText: 'suggested' }).waitFor()
    await page.keyboard.press('Backspace')
    await page.getByRole('button', { name: 'Review changes' }).click()
    await page.locator('[data-revision="insert"]').first().waitFor()
    await page.getByRole('button', { name: 'Accept all' }).click()
    assert.equal(await flow.locator('ins.docx-ins').count(), 0)
    assert.match(await text(), /Expanded character spacing \(2pt\) suggeste\b/)
  })

  await step('switches layouts and zooms', async () => {
    await page.getByRole('button', { name: 'Web layout' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.docx-page').length === 0)
    await page.getByRole('button', { name: 'Print layout' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.docx-page').length > 0)
    await page.getByRole('button', { name: 'Zoom in' }).click()
    await page.locator('[data-docx-zoom]', { hasText: '110%' }).waitFor()
  })

  await step('rejects inserted tables and accepts or rejects deleted tables in Suggesting mode', async () => {
    await open('?file=basic-formatting.docx')
    const inserted = await page.evaluate(() => {
      const editor = window.harness.editors[0]
      editor.setMode('suggesting')
      editor.insertTable(2, 2)
      const revisions = editor.revisions()
      editor.rejectAll()
      return { rows: revisions.filter((revision) => revision.kind === 'rowInsert').length, tables: editor.view.dom.querySelectorAll('table').length, remaining: editor.revisions().length }
    })
    assert.deepEqual(inserted, { rows: 2, tables: 0, remaining: 0 })
    for (const action of ['acceptAll', 'rejectAll']) {
      await open('?file=tables.docx')
      const result = await page.evaluate((action) => {
        const editor = window.harness.editors[0]
        const view = editor.view
        let table
        view.state.doc.descendants((node, pos) => {
          if (!table && node.type.name === 'table') table = { pos, size: node.nodeSize }
          return !table
        })
        const before = view.state.doc.textContent
        const count = () => view.dom.querySelectorAll('table').length
        const beforeTables = count()
        editor.setMode('suggesting')
        const Selection = view.state.selection.constructor
        view.dispatch(view.state.tr.setSelection(Selection.create(view.state.doc, table.pos, table.pos + table.size)).deleteSelection())
        const pendingTables = count()
        editor[action]()
        return { before, after: view.state.doc.textContent, beforeTables, pendingTables, afterTables: count(), remaining: editor.revisions().length }
      }, action)
      assert.equal(result.pendingTables, result.beforeTables)
      assert.equal(result.remaining, 0)
      assert.equal(result.afterTables, result.beforeTables - (action === 'acceptAll' ? 1 : 0))
      if (action === 'rejectAll') assert.equal(result.after, result.before)
    }
  })

  await step('syncs two collaborators with named carets', async () => {
    await open('?file=lists.docx&view=split')
    const left = page.locator('.docx-flow.ProseMirror').nth(0)
    const right = page.locator('.docx-flow.ProseMirror').nth(1)
    await clickEnd('List Bullet item 1', 0)
    await page.keyboard.type(' from Ada')
    await right.locator('p', { hasText: 'List Bullet item 1 from Ada' }).waitFor()
    await right.locator('.ProseMirror-yjs-cursor', { hasText: 'Ada' }).waitFor()
    await clickEnd('List Number item 2', 1)
    await page.keyboard.type(' and Grace')
    await left.locator('p', { hasText: 'List Number item 2 and Grace' }).waitFor()
    assert.equal(await page.evaluate(() => window.harness.text(0)), await page.evaluate(() => window.harness.text(1)))
  })

  await step('stays read-only when asked', async () => {
    await open('?file=review.docx&readonly=1')
    await paragraph('A comment range').click()
    await page.keyboard.type('nope')
    assert.doesNotMatch(await text(), /nope/)
    // Comments write to the shared document too, so they are off as well (but on in Viewing mode).
    const comments = await page.evaluate(() => {
      const editor = window.harness.editors[0]
      const threads = editor.comments().length
      const added = editor.addComment('nope')
      for (const thread of editor.comments()) editor.deleteComment(thread.id)
      return { added, before: threads, after: editor.comments().length, canComment: editor.canComment }
    })
    assert.deepEqual(comments, { added: null, before: comments.before, after: comments.before, canComment: false })
    assert.ok(comments.before > 0)
  })

  await step('opens links in a new tab, never in place of the app', async () => {
    const follow = async (query, modifiers) => {
      await open(query)
      await page.evaluate(() => { window.opened = []; window.open = (url) => { window.opened.push(url); return null } })
      const before = page.url()
      await flow.locator('a[href="https://example.com/"]').click({ modifiers })
      await page.waitForTimeout(200)
      assert.equal(page.url(), before)
      return page.evaluate(() => window.opened)
    }
    assert.deepEqual(await follow('?file=notes-fields.docx&readonly=1'), ['https://example.com/'])
    assert.deepEqual(await follow('?file=notes-fields.docx'), [])
    assert.deepEqual(await follow('?file=notes-fields.docx', [process.platform === 'darwin' ? 'Meta' : 'Control']), ['https://example.com/'])
  })

  await step('fills destination table cells for HTML and Pulpo table copies', async () => {
    for (const own of [false, true]) {
      await open('?layout=web')
      const result = await page.evaluate((own) => {
        const editor = window.harness.editors[0], view = editor.view, schema = view.state.schema
        const p = (text) => schema.node('paragraph', null, schema.text(text))
        const table = (a, b) => schema.node('table', null, [schema.node('tableRow', null, [schema.node('tableCell', null, [p(a)]), schema.node('tableCell', null, [p(b)])])])
        view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, [table('xy', 'zz'), table('JKL', 'MNO')]))
        const Selection = view.state.selection.constructor
        let html = '<table><tbody><tr><td>xy</td><td>zz</td></tr></tbody></table>'
        view.focus()
        if (own) {
          view.dispatch(view.state.tr.setSelection(Selection.create(view.state.doc, 4, view.state.doc.firstChild.nodeSize - 4)))
          const copy = new DataTransfer()
          view.dom.dispatchEvent(new ClipboardEvent('copy', { clipboardData: copy, bubbles: true, cancelable: true }))
          html = copy.getData('text/html')
        }
        view.dispatch(view.state.tr.setSelection(Selection.create(view.state.doc, view.state.doc.firstChild.nodeSize + 4)))
        const data = new DataTransfer()
        data.setData('text/html', html)
        data.setData('text/plain', 'xy\tzz')
        view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
        const cells = []
        let tables = 0
        view.state.doc.descendants((node) => {
          if (node.type.name === 'table') tables++
          if (node.type.name === 'tableCell') cells.push(node.textContent)
        })
        return { cells, tables }
      }, own)
      assert.deepEqual(result, { cells: ['xy', 'zz', 'xy', 'zz'], tables: 2 })
    }
  })

  await step('recalls exact Pulpo copies in header and note editors through normal paste', async () => {
    for (const kind of ['header', 'footnote']) {
      await open(kind === 'header' ? '?file=sections-headers.docx' : '?file=notes-fields.docx')
      const result = await page.evaluate((kind) => {
        const editor = window.harness.editors[0]
        const id = [...window.harness.docs[0].getMap('stories').keys()].find((id) => id.startsWith(`${kind}:`))
        editor.openStoryEditor(id)
        const view = editor.storyEditor.view, schema = view.state.schema
        const spacing = schema.mark('spacing', { v: JSON.stringify(['w:spacing', { 'w:val': '40' }]) })
        view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, schema.node('paragraph', null, schema.text('Copy', [spacing]))))
        const Selection = view.state.selection.constructor
        view.focus()
        view.dispatch(view.state.tr.setSelection(Selection.create(view.state.doc, 1, 5)))
        const data = new DataTransfer()
        view.dom.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
        view.dispatch(view.state.tr.setSelection(Selection.create(view.state.doc, 5)))
        view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
        return { text: view.state.doc.textContent, spacing: view.state.doc.firstChild.firstChild.marks.some((mark) => mark.type.name === 'spacing') }
      }, kind)
      assert.deepEqual(result, { text: 'CopyCopy', spacing: true })
    }
  })

  await step('keeps original boundaries when accepting or rejecting a whole-document suggested paste', async () => {
    for (const action of ['accept', 'reject']) {
      await open('?layout=web')
      await page.evaluate(() => {
        const view = window.harness.editors[0].view, schema = view.state.schema
        const p = (text) => schema.node('paragraph', null, schema.text(text))
        view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, [p('ABC'), p('DEF')]))
        window.pasteSelectionType = view.state.selection.constructor
        view.focus()
      })
      await page.keyboard.press(`${mod}+a`)
      const result = await page.evaluate((action) => {
        const editor = window.harness.editors[0], view = editor.view
        const data = new DataTransfer()
        view.dom.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
        editor.setMode('suggesting')
        view.dispatch(view.state.tr.setSelection(window.pasteSelectionType.create(view.state.doc, 4)))
        view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
        const deleted = editor.revisions().filter(({ kind }) => kind === 'paragraphDelete').length
        if (action === 'accept') editor.acceptAll()
        else editor.rejectAll()
        const paragraphs = []
        view.state.doc.forEach((node) => paragraphs.push(node.textContent))
        return { paragraphs, deleted, revisions: editor.revisions().length }
      }, action)
      assert.deepEqual(result, { paragraphs: action === 'accept' ? ['ABC', 'ABC', 'DEF', 'DEF'] : ['ABC', 'DEF'], deleted: 0, revisions: 0 })
      const doc = new Y.Doc()
      await docxCodec.importFile(doc, new Uint8Array(Buffer.from(await page.evaluate(() => window.harness.exportFile()), 'base64')), { name: 'a.docx', assets: new MemoryAssetStore() })
      const paragraphs = []
      readDocxModel(doc).body.forEach((node) => paragraphs.push(node.textContent))
      assert.deepEqual(paragraphs, result.paragraphs)
      doc.destroy()
    }
  })

  await step('keeps its own pictures when offline, and cleans up pastes in Suggesting mode too', async () => {
    await open('?file=objects.docx')
    const pictures = () => page.evaluate(() => {
      let count = 0
      window.harness.editors[0].view.state.doc.descendants((node) => { if (node.type.name === 'drawing' && node.attrs.src) count++ })
      return count
    })
    const before = await pictures()
    assert.ok(before > 0)
    // Offline: the store cannot load anything. Copying a picture within the document must keep every copy.
    const html = await page.evaluate(() => {
      const editor = window.harness.editors[0]
      editor.options.assets.get = () => Promise.reject(new Error('offline'))
      const view = editor.view
      let at
      view.state.doc.descendants((node, pos) => {
        if (at === undefined && node.type.name === 'drawing' && node.attrs.src) at = pos
        return at === undefined
      })
      const Selection = view.state.selection.constructor
      view.focus()
      view.dispatch(view.state.tr.setSelection(Selection.create(view.state.doc, at, at + 1)))
      const data = new DataTransfer()
      view.dom.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
      // Paste after the picture, not over it.
      view.dispatch(view.state.tr.setSelection(Selection.create(view.state.doc, at + 1)))
      return data.getData('text/html')
    })
    const paste = (markup) => page.evaluate((markup) => {
      const data = new DataTransfer()
      data.setData('text/html', markup)
      data.setData('text/plain', 'pasted')
      document.querySelector('.docx-flow.ProseMirror').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, markup)
    await paste(html)
    await page.waitForTimeout(300)
    assert.equal(await pictures(), before + 1)

    // Suggesting: a copy from elsewhere loses its unknown footnote, and pasted lists become Word lists.
    await page.evaluate(() => window.harness.editors[0].setMode('suggesting'))
    const id = 'd1'.repeat(16)
    await page.evaluate((id) => {
      const slice = { content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Suggested from elsewhere' }, { type: 'noteRef', attrs: { kind: 'footnote', id: '999' } }] }], openStart: 1, openEnd: 1 }
      localStorage.setItem('pulpo-docx-copy', JSON.stringify({ id, json: JSON.stringify(slice), origin: 'another:body', at: Date.now() }))
    }, id)
    await paste(`<p data-docx-copy="${id}">fallback</p>`)
    await page.keyboard.press('Enter')
    await paste('<ul><li>First suggested item</li><li>Suggested item</li></ul>')
    const state = await page.evaluate(() => {
      let notes = 0
      let list = null
      window.harness.editors[0].view.state.doc.descendants((node) => {
        if (node.type.name === 'noteRef' && node.attrs.id === '999') notes++
        if (node.type.name === 'paragraph' && node.textContent === 'Suggested item') list = { numPr: Boolean(node.attrs.numPr), xmlAttrs: node.attrs.xmlAttrs }
      })
      return { notes, list, text: window.harness.text() }
    })
    assert.equal(state.notes, 0)
    assert.match(state.text, /Suggested from elsewhere/)
    assert.deepEqual(state.list, { numPr: true, xmlAttrs: null })
    await page.evaluate(() => window.harness.editors[0].setMode('editing'))
  })

  await step('cuts and pastes the only copy of a picture while offline', async () => {
    await open('?file=objects.docx')
    await flow.locator('p.docx-p').first().click()
    const pictures = () => page.evaluate(() => {
      const sources = []
      window.harness.editors[0].view.state.doc.descendants((node) => {
        if (node.type.name === 'drawing' && node.attrs.src) sources.push(node.attrs.src)
      })
      return sources
    })
    // This fixture repeats its picture. Keep only its first occurrence so cutting it leaves none.
    await page.evaluate(() => {
      const view = window.harness.editors[0].view
      const positions = []
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'drawing' && node.attrs.src) positions.push(pos)
      })
      const tr = view.state.tr
      for (const pos of positions.slice(1).reverse()) tr.delete(pos, pos + 1)
      view.dispatch(tr)
    })
    const before = await pictures()
    assert.equal(before.length, 1)
    const html = await page.evaluate(() => {
      const editor = window.harness.editors[0]
      editor.options.assets.get = () => new Promise((_, reject) => setTimeout(() => reject(new Error('offline')), 200))
      const view = editor.view
      let at
      view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'drawing' && node.attrs.src) at = pos
      })
      const Selection = view.state.selection.constructor
      view.focus()
      view.dispatch(view.state.tr.setSelection(Selection.create(view.state.doc, at, at + 1)))
      const data = new DataTransfer()
      view.dom.dispatchEvent(new ClipboardEvent('cut', { clipboardData: data, bubbles: true, cancelable: true }))
      return data.getData('text/html')
    })
    assert.match(html, /data-docx-copy="[0-9a-f]{32}"/)
    assert.deepEqual(await pictures(), [])
    await page.evaluate((markup) => {
      const data = new DataTransfer()
      data.setData('text/html', markup)
      data.setData('text/plain', 'picture')
      window.harness.editors[0].view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, html)
    assert.deepEqual(await pictures(), before)
    await page.waitForTimeout(500)
    assert.deepEqual(await pictures(), before)
  })

  await step('pastes a Pulpo bold copy as plain text with Shift, and keeps bold normally', async () => {
    await open('?file=basic-formatting.docx')
    await flow.locator('p.docx-p').first().click()
    const copy = await page.evaluate(() => {
      const view = window.harness.editors[0].view
      const schema = view.state.schema
      const Selection = view.state.selection.constructor
      const text = 'Bold clipboard regression'
      const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text(text, [schema.mark('b')]))])
      view.focus()
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content))
      view.dispatch(view.state.tr.setSelection(Selection.create(view.state.doc, 1, 1 + text.length)))
      const data = new DataTransfer()
      view.dom.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
      return { html: data.getData('text/html'), text: data.getData('text/plain') }
    })
    assert.match(copy.html, /data-docx-copy="[0-9a-f]{32}"/)
    assert.equal(copy.text, 'Bold clipboard regression')
    const paste = () => page.evaluate(({ html, text }) => {
      const data = new DataTransfer()
      data.setData('text/html', html)
      data.setData('text/plain', text)
      window.harness.editors[0].view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, copy)
    const lastParagraph = () => page.evaluate(() => {
      const paragraph = window.harness.editors[0].view.state.doc.lastChild
      const marks = new Set()
      paragraph.descendants((node) => { for (const mark of node.marks) marks.add(mark.type.name) })
      return { text: paragraph.textContent, marks: [...marks] }
    })
    // Use an unformatted insertion point, so inherited marks cannot mask the paste behavior.
    const appendParagraph = () => page.evaluate(() => {
      const view = window.harness.editors[0].view
      const Selection = view.state.selection.constructor
      const tr = view.state.tr.insert(view.state.doc.content.size, view.state.schema.node('paragraph'))
      view.focus()
      view.dispatch(tr.setSelection(Selection.atEnd(tr.doc)).setStoredMarks([]))
    })
    await appendParagraph()
    await page.keyboard.down('Shift')
    try {
      assert.equal(await page.evaluate(() => window.harness.editors[0].view.input.shiftKey), true)
      await paste()
    } finally {
      await page.keyboard.up('Shift')
    }
    assert.deepEqual(await lastParagraph(), { text: copy.text, marks: [] })
    await appendParagraph()
    await paste()
    assert.deepEqual(await lastParagraph(), { text: copy.text, marks: ['b'] })
  })

  await step('pastes a remembered slice starting inside a table wider than Word allows', async () => {
    await open('?file=basic-formatting.docx')
    await clickEnd('Line spacing double')
    const id = 'e2'.repeat(16)
    const errorCount = errors.length
    const slice = await page.evaluate((id) => {
      const schema = window.harness.editors[0].view.state.schema
      const p = (text) => schema.node('paragraph', null, schema.text(text))
      const table = schema.node('table', null, [schema.node('tableRow', null,
        Array.from({ length: 70 }, (_, column) => schema.node('tableCell', null, [p(`Wide cell ${column}`)])))])
      const doc = schema.node('doc', null, [table, p('After wide table')])
      let start, end
      doc.descendants((node, pos) => {
        if (node.isText && node.text === 'Wide cell 0') start = pos + 2
        if (node.isText && node.text === 'After wide table') end = pos + 5
      })
      const slice = doc.slice(start, end)
      localStorage.setItem('pulpo-docx-copy', JSON.stringify({ id, json: JSON.stringify(slice.toJSON()), origin: 'another:body', at: Date.now() }))
      return { openStart: slice.openStart, columns: table.firstChild.childCount }
    }, id)
    assert.ok(slice.openStart > 1)
    assert.ok(slice.columns > 63)
    await page.evaluate((id) => {
      const data = new DataTransfer()
      data.setData('text/html', `<p data-docx-copy="${id}">Wide table fallback</p>`)
      data.setData('text/plain', 'Wide table fallback')
      window.harness.editors[0].view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, id)
    await paragraph('Wide cell 69').waitFor()
    assert.match(await text(), /Wide cell 1/)
    assert.doesNotMatch(await text(), /Wide table fallback/)
    assert.equal(errors.length, errorCount)
  })

  await step('leaves pre-existing orphan comment markers alone when pasting elsewhere', async () => {
    await open('?file=basic-formatting.docx')
    await flow.locator('p.docx-p').first().click()
    const id = 'pre-existing-orphan'
    await page.evaluate((id) => {
      const editor = window.harness.editors[0]
      if (editor.options.doc.getMap('stories').has(`comment:${id}`)) throw new Error('orphan story exists')
      const view = editor.view
      const schema = view.state.schema
      view.dispatch(view.state.tr.insert(1, schema.node('commentMark', { edge: 'start', id })))
    }, id)
    const markers = () => page.evaluate((id) => {
      const found = []
      window.harness.editors[0].view.state.doc.descendants((node, pos) => {
        if (node.type.name === 'commentMark' && node.attrs.id === id) found.push({ pos, edge: node.attrs.edge })
      })
      return found
    }, id)
    const before = await markers()
    assert.equal(before.length, 1)
    await clickEnd('Line spacing double')
    await page.evaluate(() => {
      const data = new DataTransfer()
      data.setData('text/html', '<p>Orphan-safe paste</p>')
      data.setData('text/plain', 'Orphan-safe paste')
      window.harness.editors[0].view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    })
    await paragraph('Orphan-safe paste').waitFor()
    assert.deepEqual(await markers(), before)
  })

  await step('disables unsupported link and cell formatting suggestions', async () => {
    await open('?file=notes-fields.docx')
    assert.equal(await page.getByRole('button', { name: 'Link', exact: true }).isEnabled(), true)
    const link = await page.evaluate(() => {
      const editor = window.harness.editors[0]
      const view = editor.view
      let target
      view.state.doc.descendants((node, pos) => {
        const link = node.marks.find((mark) => mark.type.name === 'link')
        if (!target && link) target = { from: pos, to: pos + node.nodeSize, href: link.attrs.href }
      })
      const Selection = view.state.selection.constructor
      view.focus()
      view.dispatch(view.state.tr.setSelection(Selection.create(view.state.doc, target.from, target.to)))
      const before = view.state.doc
      editor.setMode('suggesting')
      const changed = editor.setLink('https://different.example')
      const removed = editor.setLink(null)
      return { changed, removed, unchanged: before.eq(view.state.doc), href: editor.state().link, original: target.href }
    })
    assert.deepEqual(link, { changed: false, removed: false, unchanged: true, href: link.original, original: link.original })
    assert.equal(await page.getByRole('button', { name: 'Link', exact: true }).isDisabled(), true)
    let dialogs = 0
    const dismiss = async (dialog) => { dialogs++; await dialog.dismiss() }
    page.on('dialog', dismiss)
    await page.keyboard.press(`${mod}+k`)
    await page.waitForTimeout(100)
    page.off('dialog', dismiss)
    assert.equal(dialogs, 0)

    await open('?file=tables.docx')
    const cells = await page.evaluate(() => {
      const editor = window.harness.editors[0]
      const view = editor.view
      let at
      view.state.doc.descendants((node, pos) => { if (at === undefined && node.type.name === 'tableCell') at = pos + 2 })
      const Selection = view.state.selection.constructor
      view.focus()
      view.dispatch(view.state.tr.setSelection(Selection.create(view.state.doc, at)))
      editor.setMode('suggesting')
      const before = view.state.doc
      return { shading: editor.setCellShading('#ff0000'), borders: editor.setCellBorders('none'), unchanged: before.eq(view.state.doc) }
    })
    assert.deepEqual(cells, { shading: false, borders: false, unchanged: true })
    await page.getByRole('button', { name: 'Table', exact: true }).click()
    for (const name of ['Borders', 'Cell shading']) assert.equal(await page.getByRole('menuitem', { name, exact: true }).getAttribute('aria-disabled'), 'true')
    await page.keyboard.press('Escape')
    await page.evaluate(() => window.harness.editors[0].setMode('editing'))
    await page.locator('button[aria-label="Link"]:enabled').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Link', exact: true }).isEnabled(), true)
    await page.getByRole('button', { name: 'Table', exact: true }).click()
    for (const name of ['Borders', 'Cell shading']) assert.notEqual(await page.getByRole('menuitem', { name, exact: true }).getAttribute('aria-disabled'), 'true')
    await page.keyboard.press('Escape')
  })

  await step('drops colliding note and comment references only for cross-document copies', async () => {
    await open('?file=notes-fields.docx')
    const result = await page.evaluate(() => {
      const editor = window.harness.editors[0]
      const view = editor.view
      let note
      view.state.doc.descendants((node) => { if (!note && node.type.name === 'noteRef') note = node.toJSON() })
      const commentId = editor.addComment('Destination comment')
      const count = () => {
        let found = 0
        view.state.doc.descendants((node) => { if (node.type.name === 'noteRef' || node.type.name === 'commentMark') found++ })
        return found
      }
      const before = count()
      const paste = (origin, id) => {
        const slice = { content: [{ type: 'paragraph', content: [note, { type: 'commentMark', attrs: { id: commentId, edge: 'ref' } }] }], openStart: 1, openEnd: 1 }
        localStorage.setItem('pulpo-docx-copy', JSON.stringify({ id, json: JSON.stringify(slice), origin, at: Date.now() }))
        const data = new DataTransfer()
        data.setData('text/html', `<p data-docx-copy="${id}">fallback</p>`)
        data.setData('text/plain', '*')
        const Selection = view.state.selection.constructor
        view.focus()
        view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
        view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
      }
      paste('another:body', 'f3'.repeat(16))
      const foreign = count()
      // A different story in this document still shares its notes and comments.
      paste(`${editor.options.doc.guid}:header:1`, 'f4'.repeat(16))
      return { before, foreign, same: count(), commentId }
    })
    assert.ok(result.commentId)
    assert.equal(result.foreign, result.before)
    assert.equal(result.same, result.before + 2)
  })

  await step('keeps toolbar formatting and subsequent typing in the open header', async () => {
    await open('?file=sections-headers.docx')
    const body = await text()
    await page.locator('.docx-band .docx-story', { hasText: 'First-page header' }).first().dblclick()
    const story = await page.evaluate(() => window.harness.editors[0].editingStory)
    assert.ok(story)
    await page.keyboard.type('Before bold ')
    await page.getByRole('button', { name: 'Bold', exact: true }).click()
    assert.equal(await page.evaluate(() => window.harness.editors[0].editingStory), story)
    await page.keyboard.type('AFTERBOLD')
    assert.equal(await page.evaluate(() => window.harness.editors[0].state().bold), true)
    assert.match(await page.locator('.docx-story-editor').textContent(), /Before bold AFTERBOLD/)
    assert.equal(await text(), body)
    const exported = new Y.Doc()
    const base64 = await page.evaluate(() => window.harness.exportFile())
    await docxCodec.importFile(exported, Buffer.from(base64, 'base64'), { name: 'header.docx', assets: new MemoryAssetStore() })
    const header = readDocxModel(exported).stories.get(story).doc
    let bold = false
    header.descendants((node) => { if (node.isText && node.text.includes('AFTERBOLD')) bold = node.marks.some((mark) => mark.type.name === 'b') })
    assert.equal(bold, true)
    exported.destroy()
    // Clicking body content still closes the story, including after a previous explicit close.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await page.locator('.docx-band .docx-story', { hasText: 'Before bold AFTERBOLD' }).first().dblclick()
    await page.locator('.docx-story-editor').dispatchEvent('pointerdown')
    assert.equal(await page.evaluate(() => window.harness.editors[0].editingStory), story)
    await flow.locator('p.docx-p').first().click()
    assert.equal(await page.evaluate(() => window.harness.editors[0].editingStory), null)
  })

  await step('removes picture resize handles and blocks stale gestures when read-only', async () => {
    await open('?file=objects.docx')
    const drawing = flow.locator('.docx-drawing').filter({ has: page.locator('img') }).first()
    await drawing.click()
    const handle = page.locator('.docx-resize-handle')
    await handle.waitFor()
    const before = await page.evaluate(() => JSON.stringify(window.harness.model()))
    // A permission change during a drag must cancel the pending resize too.
    const box = await handle.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 40, box.y + 30)
    await page.evaluate(() => {
      const handle = document.querySelector('.docx-resize-handle')
      window.harness.editors[0].setReadOnly(true)
      handle.dispatchEvent(new PointerEvent('pointerup', { clientX: 600, clientY: 500 }))
      // Detached handles can still receive a queued pointerdown after permissions change.
      handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 600, clientY: 500 }))
    })
    await page.mouse.up()
    assert.equal(await handle.count(), 0)
    assert.equal(await page.evaluate(() => JSON.stringify(window.harness.model())), before)
    assert.equal(await page.evaluate(() => window.harness.editors[0].state().readOnly), true)
    await page.evaluate(() => window.harness.editors[0].setReadOnly(false))
    await handle.waitFor()
    await page.evaluate(() => window.harness.editors[0].setMode('viewing'))
    assert.equal(await handle.count(), 0)
    assert.equal(await page.evaluate(() => JSON.stringify(window.harness.model())), before)
  })

  await step('brings list numbering into another document in the paste undo step', async () => {
    await open('?file=lists.docx&layout=web')
    const copied = await page.evaluate(() => {
      const view = window.harness.editors[0].view
      const selection = view.state.selection.constructor
      const items = []
      view.state.doc.forEach((node, pos) => { if (node.attrs.numPr) items.push({ pos, size: node.nodeSize, text: node.textContent }) })
      view.dispatch(view.state.tr.setSelection(selection.create(view.state.doc, items[0].pos + 1, items[1].pos + items[1].size - 1)))
      const data = new DataTransfer()
      view.dom.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
      return { html: data.getData('text/html'), text: data.getData('text/plain'), items: items.slice(0, 2).map(({ text }) => text) }
    })
    await open('?layout=web')
    await page.evaluate(({ html, text }) => {
      const view = window.harness.editors[0].view
      view.focus()
      const data = new DataTransfer()
      data.setData('text/html', html)
      data.setData('text/plain', text)
      view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, copied)
    const labels = () => page.evaluate(() => [...window.harness.editors[0].view.dom.querySelectorAll('[data-label]')].map((node) => [node.textContent, node.dataset.label]))
    assert.deepEqual(await labels(), [[copied.items[0], '1.'], [copied.items[1], 'a)']])
    const exported = Buffer.from(await page.evaluate(() => window.harness.exportFile()), 'base64')
    const imported = new Y.Doc()
    await docxCodec.importFile(imported, exported, { name: 'copied-lists.docx', assets: new MemoryAssetStore() })
    const numbering = imported.getMap('numbering')
    readDocxModel(imported).body.forEach((node) => {
      if (!node.attrs.numPr) return
      const numPr = JSON.parse(node.attrs.numPr)
      const numId = numPr.slice(2).find((child) => child[0] === 'w:numId')[1]['w:val']
      const num = JSON.parse(numbering.get(`num:${numId}`))
      const abstractId = num.slice(2).find((child) => child[0] === 'w:abstractNumId')[1]['w:val']
      assert.ok(numbering.has(`abstract:${abstractId}`))
    })
    imported.destroy()
    await page.evaluate(() => window.harness.editors[0].undo())
    assert.equal(await page.evaluate(() => window.harness.editors[0].view.state.doc.textContent), '')
    assert.equal(await page.evaluate(() => window.harness.docs[0].getMap('numbering').size), 0)
    await page.evaluate(() => window.harness.editors[0].redo())
    assert.deepEqual(await labels(), [[copied.items[0], '1.'], [copied.items[1], 'a)']])
  })

  await step('keeps multilevel list properties when replacing paragraphs, including story pastes', async () => {
    await open('?layout=web')
    const copied = await page.evaluate(() => {
      const editor = window.harness.editors[0], view = editor.view, schema = view.state.schema
      const map = editor.options.doc.getMap('numbering')
      map.set('abstract:4', JSON.stringify(['w:abstractNum', { 'w:abstractNumId': '4' },
        ['w:lvl', { 'w:ilvl': '0' }, ['w:start', { 'w:val': '1' }], ['w:numFmt', { 'w:val': 'decimal' }], ['w:lvlText', { 'w:val': '%1.' }]],
        ['w:lvl', { 'w:ilvl': '1' }, ['w:start', { 'w:val': '2' }], ['w:numFmt', { 'w:val': 'upperLetter' }], ['w:lvlText', { 'w:val': '%1-%2!' }]]]))
      map.set('num:2', JSON.stringify(['w:num', { 'w:numId': '2' }, ['w:abstractNumId', { 'w:val': '4' }],
        ['w:lvlOverride', { 'w:ilvl': '0' }, ['w:startOverride', { 'w:val': '7' }]]]))
      const paragraphs = ['Alpha', 'Beta'].map((text, level) => schema.node('paragraph', {
        numPr: JSON.stringify(['w:numPr', {}, ['w:ilvl', { 'w:val': String(level) }], ['w:numId', { 'w:val': '2' }]]),
        jc: JSON.stringify(['w:jc', { 'w:val': 'center' }]), spacing: JSON.stringify(['w:spacing', { 'w:after': '240' }]),
      }, schema.text(text)))
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, paragraphs))
      view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.create(view.state.doc, 1, view.state.doc.content.size - 1)))
      const data = new DataTransfer()
      view.dom.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
      return { html: data.getData('text/html'), text: data.getData('text/plain') }
    })
    for (const target of ['empty', 'replace', 'keep', 'header']) for (const mode of ['editing', 'suggesting']) {
      await open(target === 'header' ? '?file=sections-headers.docx&layout=web' : '?layout=web')
      const beforeKeys = await page.evaluate(({ target, mode, copied }) => {
        const editor = window.harness.editors[0]
        if (target === 'header') editor.openStoryEditor([...editor.options.doc.getMap('stories').keys()].find((id) => id.startsWith('header:')))
        const view = target === 'header' ? editor.storyEditor.view : editor.view, schema = view.state.schema
        const text = target === 'empty' ? '' : 'REPLACE'
        view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, schema.node('paragraph', null, text ? schema.text(text) : null)))
        const keys = [...editor.options.doc.getMap('numbering').keys()].sort()
        view.focus()
        view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.create(view.state.doc, 1, target === 'keep' ? 2 : 1 + text.length)))
        editor.setMode(mode)
        const data = new DataTransfer()
        data.setData('text/html', copied.html); data.setData('text/plain', copied.text)
        view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
        return keys
      }, { target, mode, copied })
      const after = await page.evaluate((target) => {
        const e = window.harness.editors[0], v = target === 'header' ? e.storyEditor.view : e.view
        return { labels: [...v.dom.querySelectorAll('[data-label]')].map((node) => node.dataset.label), attrs: v.state.doc.firstChild.attrs }
      }, target)
      assert.deepEqual(after.labels, target === 'keep' ? ['1-B!'] : ['7.', '7-B!'])
      if (target !== 'keep') assert.equal(after.attrs.jc, JSON.stringify(['w:jc', { 'w:val': 'center' }]))
      if (target === 'header' && mode === 'editing') {
        const imported = new Y.Doc()
        await docxCodec.importFile(imported, Buffer.from(await page.evaluate(() => window.harness.exportFile()), 'base64'), { name: 'header-list.docx', assets: new MemoryAssetStore() })
        const header = [...readDocxModel(imported).stories.values()].find((story) => story.doc.textContent.includes('Alpha'))
        assert.ok(header)
        header.doc.forEach((node) => {
          const id = JSON.parse(node.attrs.numPr).slice(2).find((child) => child[0] === 'w:numId')[1]['w:val']
          assert.ok(imported.getMap('numbering').has(`num:${id}`))
        })
        imported.destroy()
        await page.evaluate(() => window.harness.editors[0].undo())
        assert.deepEqual(await page.evaluate(() => [...window.harness.docs[0].getMap('numbering').keys()].sort()), beforeKeys)
        assert.equal(await page.evaluate(() => window.harness.editors[0].storyEditor.view.state.doc.textContent), 'REPLACE')
      }
    }
  })

  await step('materializes style numbering only across documents and exports it intact', async () => {
    await open('?file=lists.docx&layout=web')
    const copied = await page.evaluate(() => {
      const editor = window.harness.editors[0], view = editor.view, schema = view.state.schema
      let numPr
      view.state.doc.forEach((node) => { if (!numPr && node.attrs.numPr) numPr = node.attrs.numPr })
      editor.options.doc.getMap('styles').set('style:CopiedList', JSON.stringify(['w:style', { 'w:type': 'paragraph', 'w:styleId': 'CopiedList' }, ['w:pPr', {}, JSON.parse(numPr)]]))
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, ['Style Alpha', 'Style Beta'].map((text) => schema.node('paragraph', { pStyle: 'CopiedList' }, schema.text(text)))))
      view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.create(view.state.doc, 1, view.state.doc.content.size - 1)))
      const data = new DataTransfer()
      view.dom.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
      return { html: data.getData('text/html'), text: data.getData('text/plain') }
    })
    await page.evaluate((copied) => {
      const view = window.harness.editors[0].view
      view.dispatch(view.state.tr.insert(view.state.doc.content.size, view.state.schema.node('paragraph')))
      view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.create(view.state.doc, view.state.doc.content.size - 1)))
      const data = new DataTransfer(); data.setData('text/html', copied.html); data.setData('text/plain', copied.text)
      view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, copied)
    assert.equal(await page.evaluate(() => window.harness.editors[0].view.state.doc.lastChild.attrs.numPr), null)
    assert.deepEqual(await page.evaluate(() => [...window.harness.editors[0].view.dom.querySelectorAll('[data-label]')].map((node) => node.dataset.label)), ['1.', '2.', '3.', '4.'])
    await open('?layout=web')
    await page.evaluate((copied) => {
      const view = window.harness.editors[0].view, data = new DataTransfer()
      data.setData('text/html', copied.html); data.setData('text/plain', copied.text)
      view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, copied)
    assert.deepEqual(await page.evaluate(() => [...window.harness.editors[0].view.dom.querySelectorAll('[data-label]')].map((node) => node.dataset.label)), ['1.', '2.'])
    const imported = new Y.Doc()
    await docxCodec.importFile(imported, Buffer.from(await page.evaluate(() => window.harness.exportFile()), 'base64'), { name: 'style-list.docx', assets: new MemoryAssetStore() })
    readDocxModel(imported).body.forEach((node) => {
      assert.ok(node.attrs.numPr)
      const id = JSON.parse(node.attrs.numPr).slice(2).find((child) => child[0] === 'w:numId')[1]['w:val']
      assert.ok(imported.getMap('numbering').has(`num:${id}`))
    })
    imported.destroy()
  })

  await step('keeps first-item HTML list properties when replacing all text in either mode', async () => {
    for (const mode of ['editing', 'suggesting']) {
      await open('?layout=web')
      const labels = await page.evaluate((mode) => {
        const editor = window.harness.editors[0], view = editor.view
        view.dispatch(view.state.tr.insertText('REPLACE', 1))
        view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.create(view.state.doc, 1, 8)))
        editor.setMode(mode)
        const data = new DataTransfer()
        data.setData('text/html', '<ol><li style="text-align:center">Alpha</li><li>Beta</li></ol>')
        data.setData('text/plain', 'Alpha\nBeta')
        view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
        if (mode === 'suggesting') editor.acceptAll()
        return [...view.dom.querySelectorAll('[data-label]')].map((node) => [node.textContent, node.dataset.label])
      }, mode)
      assert.deepEqual(labels, [['Alpha', '1.'], ['Beta', '2.']])
      assert.equal(await page.evaluate(() => window.harness.editors[0].view.state.doc.firstChild.attrs.jc), JSON.stringify(['w:jc', { 'w:val': 'center' }]))
    }
  })

  await step('refreshes find results and replacement controls after collaborative text edits', async () => {
    await open('?view=split')
    await page.evaluate(() => window.harness.editors[0].view.dispatch(window.harness.editors[0].view.state.tr.insertText('cat', 1)))
    await flow.click()
    await page.keyboard.press(`${mod}+h`)
    await page.getByRole('textbox', { name: 'Find in document' }).fill('cat')
    await page.waitForFunction(() => window.harness.editors[0].findState().count === 1)
    await page.evaluate(() => {
      const view = window.harness.editors[1].view
      view.dispatch(view.state.tr.insertText('o', 2))
    })
    await page.waitForFunction(() => window.harness.editors[0].findState().count === 0)
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent === 'Replace all' && button.disabled))
    assert.equal(await text(), 'coat\n')
    await page.evaluate(() => {
      const view = window.harness.editors[1].view
      view.dispatch(view.state.tr.insertText(' cat cat', 5))
    })
    await page.waitForFunction(() => window.harness.editors[0].findState().count === 2)
    await page.getByRole('textbox', { name: 'Replace with' }).fill('dog')
    await page.getByRole('button', { name: 'Replace all', exact: true }).click()
    assert.equal(await text(), 'coat dog dog\n')
    assert.equal(await exported(), 'coat dog dog\n')
    await page.keyboard.press('Escape')
  })

  await step('searches and exports accepted table text while preserving deletion markup', async () => {
    await open('')
    await page.evaluate(() => {
      const view = window.harness.editors[0].view
      const schema = view.state.schema
      const cell = (text, deleted = false) => schema.node('tableCell', { tcPr: deleted ? JSON.stringify(['w:tcPr', {}, ['w:cellDel', {}]]) : null }, schema.node('paragraph', null, schema.text(text)))
      const row = (text, revision) => schema.node('tableRow', { trPr: revision ? JSON.stringify(['w:trPr', {}, [revision, {}]]) : null }, [cell(text), cell('deleted cell', true)])
      const table = schema.node('table', null, [row('deleted row', 'w:del'), row('kept'), row('inserted row', 'w:ins')])
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, table))
    })
    assert.equal(await text(), '| kept |\n| inserted row |\n')
    assert.equal(await exported(), '| kept |\n| inserted row |\n')
    assert.equal(await page.evaluate(() => window.harness.editors[0].find('deleted')), 0)
    assert.equal(await page.evaluate(() => window.harness.editors[0].find('inserted row')), 1)
    assert.equal(await page.evaluate(() => window.harness.editors[0].revisions().filter((revision) => revision.kind === 'rowDelete' || revision.kind === 'rowInsert').length), 2)
  })

  await step('uses the same paragraph-join semantics for text, Find, and Accept all', async () => {
    await open('')
    await page.evaluate(() => {
      const view = window.harness.editors[0].view
      const schema = view.state.schema
      const first = schema.node('paragraph', { markRPr: JSON.stringify(['w:rPr', {}, ['w:del', { 'w:id': '801', 'w:author': 'Ada' }]]) }, schema.text('foo'))
      const second = schema.node('paragraph', null, schema.text('bar'))
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, [first, second]))
    })
    assert.equal(await text(), 'foobar\n')
    assert.equal(await exported(), 'foobar\n')
    assert.equal(await page.evaluate(() => window.harness.editors[0].find('foobar')), 1)
    assert.equal(await page.evaluate(() => window.harness.editors[0].acceptAll()), true)
    assert.equal(await page.evaluate(() => window.harness.editors[0].view.state.doc.childCount), 1)
    assert.equal(await text(), 'foobar\n')
    assert.equal(await page.evaluate(() => window.harness.editors[0].revisions().length), 0)
  })

  await step('replaces matches in source order when accepted rows relocate spanning cells', async () => {
    await open('')
    await page.evaluate(() => {
      const view = window.harness.editors[0].view
      const schema = view.state.schema
      const p = (text) => schema.node('paragraph', null, schema.text(text))
      const cell = (text, rowspan = 1) => schema.node('tableCell', { rowspan }, p(text))
      const row = (cells, kind) => schema.node('tableRow', { trPr: JSON.stringify(['w:trPr', {}, [kind, { 'w:id': kind, 'w:author': 'Ada' }]]) }, cells)
      const table = schema.node('table', null, [row([cell('hidden cat'), cell('cat', 2)], 'w:del'), row([cell('cat')], 'w:ins')])
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, [table, p('cat')]))
    })
    assert.equal(await page.evaluate(() => window.harness.editors[0].find('cat')), 3)
    assert.equal(await page.evaluate(() => window.harness.editors[0].replaceAll('x', 'cat')), 3)
    assert.equal(await text(), '| x | x |\nx\n')
    assert.equal(await exported(), '| x | x |\nx\n')
    assert.equal(await page.evaluate(() => window.harness.editors[0].view.state.doc.firstChild.firstChild.firstChild.textContent), 'hidden cat')
  })

  await step('exits direct and inherited lists with Enter and Backspace and updates toolbar state', async () => {
    await open('')
    assert.equal(await page.evaluate(() => {
      const editor = window.harness.editors[0]
      const doc = editor.options.doc
      doc.transact(() => {
        doc.getMap('styles').set('style:InheritedList', JSON.stringify(['w:style', { 'w:type': 'paragraph', 'w:styleId': 'InheritedList' }, ['w:pPr', {}, ['w:numPr', {}, ['w:numId', { 'w:val': '901' }]]]]))
        doc.getMap('numbering').set('abstract:901', JSON.stringify(['w:abstractNum', { 'w:abstractNumId': '901' },
          ['w:lvl', { 'w:ilvl': '0' }, ['w:numFmt', { 'w:val': 'decimal' }], ['w:lvlText', { 'w:val': '%1.' }]],
          ['w:lvl', { 'w:ilvl': '1' }, ['w:numFmt', { 'w:val': 'lowerLetter' }], ['w:lvlText', { 'w:val': '%2.' }]]]))
        for (const id of ['901', '902']) doc.getMap('numbering').set(`num:${id}`, JSON.stringify(['w:num', { 'w:numId': id }, ['w:abstractNumId', { 'w:val': '901' }]]))
      })
      const view = editor.view
      const p = view.state.schema.node('paragraph', { pStyle: 'InheritedList', numPr: JSON.stringify(['w:numPr', {}, ['w:numId', { 'w:val': '902' }]]) })
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, p))
      view.focus()
      return editor.state().list
    }), 'decimal')
    await page.keyboard.press('Enter')
    assert.equal(await page.evaluate(() => window.harness.editors[0].state().list), null)
    assert.equal(await page.evaluate(() => window.harness.editors[0].view.state.doc.childCount), 1)
    await page.evaluate(() => window.harness.editors[0].toggleList('decimal'))
    assert.equal(await page.evaluate(() => window.harness.editors[0].state().list), 'decimal')
    await page.keyboard.press('Backspace')
    assert.equal(await page.evaluate(() => window.harness.editors[0].state().list), null)
    assert.equal(await exported(), '\n')
  })

  await step('places the typing cursor after insert commands and table pastes', async () => {
    await open('')
    const p = (text = '', attrs) => ({ type: 'paragraph', attrs, ...(text ? { content: [{ type: 'text', text }] } : {}) })
    const unrelated = { type: 'table', content: [{ type: 'tableRow', content: [{ type: 'tableCell', content: [p('Unrelated table')] }] }] }
    const reset = async (content = [p('LeftRight')], from = 5) => {
      await page.evaluate(({ content, from }) => {
        const editor = window.harness.editors[0]
        editor.closeStoryEditor()
        const view = editor.view
        view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, content.map((node) => view.state.schema.nodeFromJSON(node))))
        view.dispatch(view.state.tr.setSelection(view.state.selection.constructor.create(view.state.doc, from)))
        view.focus()
      }, { content, from })
    }
    const insert = async (name, submenu) => {
      await page.getByRole('button', { name: 'Insert', exact: true }).click()
      if (submenu) await page.getByRole('menuitem', { name: submenu, exact: true }).hover()
      await page.getByRole('menuitem', { name, exact: true }).click()
    }
    const typeText = async (text) => {
      await page.waitForFunction(() => window.harness.editors[0].hasFocus)
      await page.keyboard.type(text)
    }
    const blocks = () => page.evaluate(() => {
      const nodes = []
      window.harness.editors[0].view.state.doc.forEach((node) => nodes.push({ type: node.type.name, text: node.textContent }))
      return nodes
    })

    for (const content of [[p()], [p(), unrelated, p()]]) {
      await reset(content, 1)
      await page.getByRole('button', { name: 'Insert', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Table', exact: true }).hover()
      await page.getByRole('button', { name: '2 by 2 table' }).click()
      await typeText('New cell')
      assert.equal(await page.evaluate(() => window.harness.editors[0].view.state.doc.firstChild.firstChild.firstChild.textContent), 'New cell', 'new table first cell')
      if (content.length > 1) assert.equal((await blocks())[2].text, 'Unrelated table')
    }

    await reset()
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
    await page.locator('input[type=file][accept^="image/"]').setInputFiles({ name: 'caret.png', mimeType: 'image/png', buffer: png })
    await page.waitForFunction(() => window.harness.editors[0].view.state.doc.firstChild.maybeChild(1)?.type.name === 'drawing')
    await typeText('Image tail')
    assert.deepEqual(await page.evaluate(() => window.harness.editors[0].view.state.doc.firstChild.content.content.map((node) => node.isText ? node.text : node.type.name)), ['Left', 'drawing', 'Image tailRight'])

    await reset()
    await insert('Page break')
    await typeText('Page tail')
    assert.deepEqual(await blocks(), [{ type: 'paragraph', text: 'Left' }, { type: 'paragraph', text: 'Page tailRight' }])
    assert.equal(await page.evaluate(() => window.harness.editors[0].view.state.doc.firstChild.lastChild.type.name), 'break')

    for (const type of ['Next page', 'Continuous', 'Even page', 'Odd page']) {
      await reset()
      await insert(type, 'Section break')
      await typeText('Section tail')
      assert.deepEqual(await blocks(), [{ type: 'paragraph', text: 'Left' }, { type: 'paragraph', text: 'Section tailRight' }], type)
      assert.ok(await page.evaluate(() => Boolean(window.harness.editors[0].view.state.doc.firstChild.attrs.sectPr)))
    }

    await reset([p(), p('Heading', { outlineLvl: JSON.stringify(['w:outlineLvl', { 'w:val': '0' }]) })], 1)
    await insert('Table of contents')
    await typeText('After TOC')
    assert.equal((await blocks())[1].text, 'After TOC')
    assert.equal(await page.evaluate(() => window.harness.editors[0].view.state.doc.firstChild.lastChild.attrs.charType), 'end')

    for (const kind of ['Footnote', 'Endnote']) {
      await reset()
      await insert(kind)
      await typeText('Note text')
      assert.ok(await page.evaluate((kind) => window.harness.editors[0].editingStory?.startsWith(`${kind}:`), kind.toLowerCase()), kind)
      assert.equal((await exported(kind.toLowerCase())).trim(), 'Note text')
      assert.equal((await blocks())[0].text, 'LeftRight')
      await page.keyboard.press('Escape')
      await typeText('Body tail')
      assert.equal((await blocks())[0].text, 'LeftBody tailRight')
    }

    await reset()
    await page.getByRole('button', { name: 'Insert', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Symbol', exact: true }).hover()
    await page.getByRole('button', { name: '©', exact: true }).click()
    await typeText('Symbol tail')
    assert.equal((await blocks())[0].text, 'Left©Symbol tailRight')

    await reset([p(), unrelated, p()], 1)
    await page.evaluate(() => {
      const data = new DataTransfer()
      data.setData('text/html', '<table><tr><td>Pasted A</td><td>Pasted B</td></tr></table>')
      data.setData('text/plain', 'Pasted A\tPasted B')
      window.harness.editors[0].view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    })
    await typeText('After paste')
    assert.deepEqual(await blocks(), [{ type: 'table', text: 'Pasted APasted B' }, { type: 'paragraph', text: 'After paste' }, { type: 'table', text: 'Unrelated table' }, { type: 'paragraph', text: '' }])
  })

  await step('keeps custom notes visible and pagination geometry stable across zoom levels', async () => {
    await open('?file=sections-headers.docx')
    const keys = await page.evaluate(() => {
      const editor = window.harness.editors[0]
      const doc = editor.options.doc
      const schema = editor.view.state.schema
      const spacing = JSON.stringify(['w:spacing', { 'w:before': '0', 'w:after': '0', 'w:line': '480', 'w:lineRule': 'exact' }])
      const p = (text, content) => schema.node('paragraph', { spacing }, content ?? schema.text(text))
      const refs = []
      for (const kind of ['header', 'footer']) {
        const [key] = [...doc.getMap('stories')].find(([, json]) => JSON.parse(json).kind === kind)
        const [id] = [...doc.getMap('rels')].find(([, json]) => JSON.parse(json).type.endsWith(`/${kind}`))
        for (const type of ['default', 'even']) refs.push([`w:${kind}Reference`, { 'w:type': type, 'r:id': id }])
        editor.openStoryEditor(key)
        const view = editor.storyEditor.view
        view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, Array.from({ length: kind === 'header' ? 10 : 6 }, (_, index) => p(`Tall ${kind} line ${index}`))))
        editor.closeStoryEditor()
      }
      doc.getMap('docx').set('sectPr', JSON.stringify(['w:sectPr', {}, ...refs]))
      const keys = []
      const noteRefs = []
      for (const kind of ['footnote', 'endnote']) {
        const id = editor.insertNote(kind)
        const key = `${kind}:${id}`
        keys.push(key)
        const view = editor.storyEditor.view
        const mark = view.state.doc.firstChild.firstChild
        view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, Array.from({ length: 3 }, (_, index) => p('', index ? [schema.text(`Custom ${kind} line ${index}`)] : [mark, schema.text(`* Custom ${kind} line 0`)]))))
        editor.closeStoryEditor()
        noteRefs.push(schema.node('noteRef', { kind, id, v: JSON.stringify([`w:${kind}Reference`, { 'w:id': id, 'w:customMarkFollows': '1' }]) }), schema.text('*'))
      }
      const row = (index) => schema.node('tableRow', { trPr: index === 0 ? JSON.stringify(['w:trPr', {}, ['w:tblHeader', {}]]) : null }, [schema.node('tableCell', null, [p(`Table row ${index}`)])])
      const table = schema.node('table', null, Array.from({ length: 12 }, (_, index) => row(index)))
      const view = editor.view
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, [p('', [schema.text('References '), ...noteRefs, schema.node('tab', { v: JSON.stringify(['w:tab', {}]) }), schema.text('Tabbed suffix')]), ...Array.from({ length: 8 }, (_, index) => p(`Body line ${index}`)), table]))
      editor.relayout()
      return keys
    })
    const metrics = () => page.evaluate(() => {
      const editor = window.harness.editors[0]
      return { pages: editor.pages, top: editor.lastLayout.pages[0].setup.top, bottom: editor.lastLayout.pages[0].setup.bottom, footnote: [...editor.noteHeights.values()][0], endnote: editor.endnotesHeight, tabs: [...editor.view.dom.querySelectorAll('.docx-tab')].map((element) => parseFloat(element.style.width)), repeatedRows: editor.root.querySelectorAll('.docx-repeated-header').length }
    })
    const baseline = await metrics()
    assert.ok(baseline.top > 200 && baseline.bottom > 100 && baseline.footnote > 60 && baseline.endnote > 60 && baseline.repeatedRows > 0 && baseline.tabs.length > 0, JSON.stringify(baseline))
    for (const zoom of [0.25, 0.5, 2, 4, 1.1, 1]) {
      await page.evaluate((zoom) => { const editor = window.harness.editors[0]; editor.setZoom(zoom); editor.relayout() }, zoom)
      const next = await metrics()
      assert.equal(next.pages, baseline.pages, `pages at zoom ${zoom}`)
      assert.equal(next.repeatedRows, baseline.repeatedRows, `repeated rows at zoom ${zoom}`)
      assert.equal(next.tabs.length, baseline.tabs.length)
      next.tabs.forEach((width, index) => assert.ok(Math.abs(width - baseline.tabs[index]) < 2, `tab width at zoom ${zoom}`))
      for (const value of ['top', 'bottom', 'footnote', 'endnote']) assert.ok(Math.abs(next[value] - baseline[value]) < 1, `${value} at zoom ${zoom}: ${next[value]} vs ${baseline[value]}`)
      for (const key of keys) assert.match(await page.locator(`[data-story="${key}"]`).innerText(), /Custom (footnote|endnote) line 0/)
    }
    for (const layout of ['web', 'print']) {
      await page.evaluate((layout) => { const editor = window.harness.editors[0]; editor.setLayout(layout); editor.relayout() }, layout)
      for (const key of keys) assert.match(await page.locator(`[data-story="${key}"]`).innerText(), /Custom (footnote|endnote) line 0/)
    }
  })

  await step('measures inherited stories at section widths and shares configured note labels', async () => {
    await open('?file=sections-headers.docx')
    const keys = await page.evaluate(() => {
      const editor = window.harness.editors[0]
      const doc = editor.options.doc
      const schema = editor.view.state.schema
      const refs = []
      const p = (text, attrs) => schema.node('paragraph', attrs, schema.text(text))
      const long = 'A wrapping story with several words for measuring narrow sections. '.repeat(8)
      for (const kind of ['header', 'footer']) {
        const [key] = [...doc.getMap('stories')].find(([, json]) => JSON.parse(json).kind === kind)
        const [id] = [...doc.getMap('rels')].find(([, json]) => JSON.parse(json).type.endsWith(`/${kind}`))
        for (const type of ['default', 'even']) refs.push([`w:${kind}Reference`, { 'w:type': type, 'r:id': id }])
        editor.openStoryEditor(key)
        const view = editor.storyEditor.view
        view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, p(long)))
        editor.closeStoryEditor()
      }
      const settings = (kind, format, start) => [`w:${kind}Pr`, {}, ['w:numFmt', { 'w:val': format }], ['w:numStart', { 'w:val': String(start) }]]
      for (const kind of ['footnote', 'endnote']) doc.getMap('settings').set(`w:${kind}Pr`, JSON.stringify([...settings(kind, 'decimal', 6), ['w:numRestart', { 'w:val': 'eachSect' }]]))
      const keys = []
      const sections = [[], []]
      for (let section = 0; section < 2; section++) for (const kind of ['footnote', 'endnote']) for (let index = 0; index < 2; index++) {
        const id = editor.insertNote(kind, kind === 'footnote' ? long : `Endnote ${section}-${index}`)
        keys.push(`${kind}:${id}`)
        editor.closeStoryEditor()
        sections[section].push(schema.node('noteRef', { kind, id }))
      }
      const wide = JSON.stringify(['w:sectPr', {}, ...refs, ['w:pgSz', { 'w:w': '11880', 'w:h': '15840' }], settings('footnote', 'lowerRoman', 3)])
      doc.getMap('docx').set('sectPr', JSON.stringify(['w:sectPr', {}, ['w:pgSz', { 'w:w': '7380', 'w:h': '15840' }], settings('footnote', 'upperRoman', 5), settings('endnote', 'lowerLetter', 2)]))
      const view = editor.view
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, [schema.node('paragraph', { sectPr: wide }, sections[0]), schema.node('paragraph', null, sections[1])]))
      editor.relayout()
      return keys
    })
    const expected = ['iii', 'iv', '6', '7', 'V', 'VI', 'b', 'c']
    const bodyLabels = () => flow.locator('.docx-noteref').evaluateAll((nodes) => nodes.map((node) => node.dataset.label))
    assert.deepEqual(await bodyLabels(), expected)
    const measured = await page.evaluate((keys) => {
      const editor = window.harness.editors[0]
      return { top: editor.lastLayout.pages.filter((page) => page.firstOfSection).map((page) => page.setup.top), bottom: editor.lastLayout.pages.filter((page) => page.firstOfSection).map((page) => page.setup.bottom), wide: editor.noteHeights.get(keys[0]), narrow: editor.noteHeights.get(keys[4]), endnoteWidth: parseFloat(editor.notesHost.style.width), endnoteHeight: editor.endnotesHeight, renderedEndnoteHeight: editor.notesHost.getBoundingClientRect().height / editor.zoom }
    }, keys)
    assert.ok(measured.top[1] > measured.top[0] + 10, JSON.stringify(measured))
    assert.ok(measured.bottom[1] > measured.bottom[0] + 10, JSON.stringify(measured))
    assert.ok(measured.narrow > measured.wide + 10, JSON.stringify(measured))
    assert.equal(measured.endnoteWidth, 300)
    assert.ok(Math.abs(measured.endnoteHeight - measured.renderedEndnoteHeight) < 1)
    for (const layout of ['print', 'web']) {
      await page.evaluate((layout) => { const editor = window.harness.editors[0]; editor.setLayout(layout); editor.relayout() }, layout)
      assert.deepEqual(await bodyLabels(), expected)
      for (const [index, key] of keys.entries()) assert.equal(await page.locator(`[data-story="${key}"] [data-label]`).first().getAttribute('data-label'), expected[index])
    }
    await page.evaluate((keys) => {
      const editor = window.harness.editors[0]
      const schema = editor.view.state.schema
      for (const kind of ['footnote', 'endnote']) editor.options.doc.getMap('settings').set(`w:${kind}Pr`, JSON.stringify([`w:${kind}Pr`, {}, ['w:numFmt', { 'w:val': 'decimal' }], ['w:numStart', { 'w:val': '4' }], ['w:numRestart', { 'w:val': 'eachPage' }]]))
      editor.options.doc.getMap('docx').set('sectPr', JSON.stringify(['w:sectPr', {}]))
      const refs = (part) => keys.slice(part * 4, part * 4 + 4).map((key) => { const [kind, id] = key.split(':'); return schema.node('noteRef', { kind, id }) })
      const view = editor.view
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, [schema.node('paragraph', null, refs(0)), schema.node('paragraph', { pageBreakBefore: JSON.stringify(['w:pageBreakBefore', {}]) }, refs(1))]))
      editor.setLayout('print')
      editor.relayout()
    }, keys)
    assert.deepEqual(await bodyLabels(), ['4', '5', '4', '5', '4', '5', '4', '5'])
  })

  await step('constrains body paragraphs, tables, and wrappers before pagination', async () => {
    await open('')
    await page.evaluate(() => {
      const editor = window.harness.editors[0]
      const schema = editor.view.state.schema
      const section = (width) => JSON.stringify(['w:sectPr', {}, ['w:pgSz', { 'w:w': String(width), 'w:h': '15840' }]])
      const long = 'The same paragraph wraps within the section text area. '.repeat(35)
      const p = (text, attrs) => schema.node('paragraph', attrs, schema.text(text))
      const table = (percent, align = 'left') => schema.node('table', {
        tblPr: JSON.stringify(['w:tblPr', {}, ['w:tblW', { 'w:type': 'pct', 'w:w': String(percent * 50) }], ['w:jc', { 'w:val': align }], ['w:tblLayout', { 'w:type': 'fixed' }]]),
        tblGrid: JSON.stringify(['w:tblGrid', {}, ['w:gridCol', { 'w:w': '2250' }], ['w:gridCol', { 'w:w': '6750' }]]),
      }, Array.from({ length: align === 'center' ? 12 : 1 }, (_, index) => schema.node('tableRow', index === 0 ? { trPr: JSON.stringify(['w:trPr', {}, ['w:tblHeader', {}]]) } : null, (index === 0 ? ['Head', 'Header'] : ['Small words fit within the cell. '.repeat(3), 'Another cell with short words. '.repeat(3)]).map((text) => schema.node('tableCell', null, p(text))))))
      const wrapper = schema.node('blockWrapper', { v: JSON.stringify(['w:sdt', {}, '\u0000']) }, [p(long), schema.node('blockWrapper', { v: JSON.stringify(['w:sdt', {}, '\u0000']) }, [table(50)])])
      editor.options.doc.getMap('docx').set('sectPr', section(7380))
      const view = editor.view
      view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, [p(long, { sectPr: section(11880) }), p(long, { ind: JSON.stringify(['w:ind', { 'w:left': '240', 'w:right': '120' }]) }), table(100), table(50, 'center'), table(50, 'right'), wrapper, p('End')]))
      editor.relayout()
    })
    const metrics = () => page.evaluate(() => {
      const editor = window.harness.editors[0]
      const flow = editor.view.dom
      const scale = flow.getBoundingClientRect().width / flow.offsetWidth
      const width = (element) => element.getBoundingClientRect().width / scale
      const blocks = [...flow.children].filter((node) => !node.classList.contains('docx-page-spacer'))
      const tables = [...flow.querySelectorAll(':scope > table')]
      const root = flow.getBoundingClientRect()
      const wrapper = flow.querySelector(':scope > .docx-wrapper')
      const range = document.createRange()
      const text = document.createTreeWalker(blocks[1], NodeFilter.SHOW_TEXT)
      const lines = new Set()
      for (let node = text.nextNode(); node; node = text.nextNode()) {
        range.selectNodeContents(node)
        for (const rect of range.getClientRects()) if (rect.height > 0) lines.add(Math.round(rect.top / scale * 10))
      }
      const repeated = [...editor.root.querySelectorAll('.docx-repeated-header table')].map((table) => ({ width: width(table), left: (table.getBoundingClientRect().left - root.left) / scale }))
      return { pages: editor.pages, wide: width(blocks[0]), narrow: width(blocks[1]), tables: tables.map(width), centers: tables.map((table) => (table.getBoundingClientRect().left - root.left) / scale), wrapper: width(wrapper), nestedParagraph: width(wrapper.querySelector('p')), nestedTable: width(wrapper.querySelector('table')), measuredLines: editor.lastUnits.find((unit) => unit.block === 1 && unit.kind === 'line').lines, renderedLines: lines.size, repeated }
    })
    const baseline = await metrics()
    assert.ok(Math.abs(baseline.wide - 600) < 1, JSON.stringify(baseline))
    assert.ok(Math.abs(baseline.narrow - 276) < 1, JSON.stringify(baseline))
    assert.deepEqual(baseline.tables.map(Math.round), [300, 150, 150])
    assert.deepEqual(baseline.centers.map(Math.round), [0, 75, 150])
    assert.equal(Math.round(baseline.wrapper), 300)
    assert.equal(Math.round(baseline.nestedParagraph), 300)
    assert.equal(Math.round(baseline.nestedTable), 150)
    assert.equal(baseline.measuredLines, baseline.renderedLines)
    assert.ok(baseline.repeated.length > 0)
    for (const repeat of baseline.repeated) assert.deepEqual([Math.round(repeat.width), Math.round(repeat.left)], [150, 75])
    for (const zoom of [0.5, 2, 1]) {
      await page.evaluate((zoom) => { const editor = window.harness.editors[0]; editor.setZoom(zoom); editor.relayout() }, zoom)
      const next = await metrics()
      assert.equal(next.pages, baseline.pages)
      assert.deepEqual(next.tables.map(Math.round), [300, 150, 150])
      assert.equal(next.measuredLines, next.renderedLines)
      for (const repeat of next.repeated) assert.deepEqual([Math.round(repeat.width), Math.round(repeat.left)], [150, 75])
    }
    await page.emulateMedia({ media: 'print' })
    assert.deepEqual((await metrics()).tables.map(Math.round), [300, 150, 150])
    await page.emulateMedia({ media: 'screen' })
    await page.evaluate(() => {
      const editor = window.harness.editors[0]
      editor.options.doc.getMap('docx').set('sectPr', JSON.stringify(['w:sectPr', {}, ['w:pgSz', { 'w:w': '11880', 'w:h': '15840' }]]))
      editor.relayout()
    })
    assert.ok((await metrics()).pages < baseline.pages, JSON.stringify(baseline))
  })

  await step('breaks lines with Shift+Enter and formats lists, quotes, and links as you type', async () => {
    await open('')
    await flow.click()
    await page.keyboard.type('Line one')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('Line two')
    const broken = flow.locator('p.docx-p', { hasText: 'Line two' })
    assert.equal(await broken.locator('br:not(.ProseMirror-trailingBreak)').count(), 1)
    assert.match(await broken.innerText(), /Line one\nLine two/)
    assert.equal(await page.evaluate(() => window.harness.editors[0].view.state.doc.childCount), 1)
    assert.match(await exported(), /^Line one\nLine two\n?$/)
    await page.keyboard.press('Enter')
    await page.keyboard.type('1. First')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Second')
    await flow.locator('p[data-label="1."]', { hasText: 'First' }).waitFor()
    await flow.locator('p[data-label="2."]', { hasText: 'Second' }).waitFor()
    // A line break inside a list item keeps one number.
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('more')
    assert.equal(await flow.locator('p[data-label]').count(), 2)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('- ')
    await flow.locator('p[data-label="•"]').last().waitFor()
    // Backspace right after the conversion gives the typed marker back.
    await page.keyboard.press('Backspace')
    await page.waitForFunction(() => window.harness.editors[0].view.state.doc.lastChild.textContent === '- ')
    assert.equal(await page.evaluate(() => window.harness.editors[0].state().list), null)
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('a) ')
    await flow.locator('p[data-label="a)"]').waitFor()
    // Undo right after the conversion keeps the literal marker, with the cursor after it.
    await page.keyboard.press(`${mod}+z`)
    await page.keyboard.type('Lettered')
    await page.waitForFunction(() => window.harness.editors[0].view.state.doc.lastChild.textContent === 'a) Lettered')
    assert.equal(await flow.locator('p[data-label="a)"]').count(), 0)
    await page.keyboard.press('Enter')
    await page.keyboard.type('She said "it\'s fine" -- see www.example.com and more')
    const last = await page.evaluate(() => window.harness.editors[0].view.state.doc.lastChild.textContent)
    assert.equal(last, 'She said “it’s fine” – see www.example.com and more')
    await flow.locator('a[href="https://www.example.com"]', { hasText: 'www.example.com' }).waitFor()
    assert.deepEqual(errors, [])
  })

  await step('moves through table cells with Tab, adds a row from the last, and keeps focus in the document', async () => {
    await open('')
    await flow.click()
    await page.keyboard.type('Before the table')
    await page.getByRole('button', { name: 'Insert', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Table', exact: true }).hover()
    await page.getByRole('button', { name: '2 by 3 table' }).click()
    const table = flow.locator('table.docx-table').last()
    for (let cell = 0; cell < 6; cell++) {
      await page.keyboard.type(`C${cell}`)
      await page.keyboard.press('Tab')
    }
    assert.equal(await table.locator('tr').count(), 3)
    assert.ok(await page.evaluate(() => document.activeElement?.closest('.docx-flow') !== null))
    await page.keyboard.type('Row three')
    assert.match(await table.locator('tr').nth(2).locator('td').first().innerText(), /Row three/)
    await page.keyboard.press('Shift+Tab')
    assert.ok(await page.evaluate(() => document.activeElement?.closest('.docx-flow') !== null))
    await clickEnd('Before the table')
    await page.keyboard.press('Shift+Tab')
    assert.ok(await page.evaluate(() => document.activeElement?.closest('.docx-flow') !== null))
    assert.match(await exported(), /\| C0 \| C1 \|/)
    assert.match(await exported(), /\| Row three \|/)
  })

  await step('keeps the app shortcuts it handles inside an editable document', async () => {
    await open('?file=basic-formatting.docx')
    await clickEnd('A normal paragraph with plain text', 0, 5)
    await page.evaluate(() => {
      window.keyLog = []
      window.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && !['Control', 'Meta'].includes(event.key)) window.keyLog.push({ key: event.key, prevented: event.defaultPrevented }) })
    })
    let dialogs = 0
    const dismiss = async (dialog) => { dialogs++; await dialog.dismiss() }
    page.on('dialog', dismiss)
    for (const key of ['b', 'j', 'e', 'k', '\\', ',']) {
      await page.keyboard.press(`${mod}+${key}`)
      await page.keyboard.press(`${mod}+${key}`)
    }
    page.off('dialog', dismiss)
    const log = await page.evaluate(() => window.keyLog)
    assert.equal(log.length, 12)
    assert.deepEqual(log.filter((entry) => !entry.prevented), [])
    assert.equal(dialogs, 2)
    // Ctrl/Cmd+J twice justifies, then goes back to left, as in Word.
    assert.equal(await page.evaluate(() => window.harness.editors[0].state().alignment), 'left')
  })

  await step('applies heading styles with Ctrl+Alt+number, adding built-in ones the document lacks', async () => {
    await open('')
    await flow.click()
    await page.keyboard.type('Fourth level')
    await page.keyboard.press(`${mod}+Alt+4`)
    await flow.locator('p.docx-ps-Heading4', { hasText: 'Fourth level' }).waitFor()
    await page.keyboard.press(`${mod}+Alt+6`)
    const sixth = flow.locator('p.docx-ps-Heading6', { hasText: 'Fourth level' })
    await sixth.waitFor()
    // Word's built-in Heading 6 came with it: accent-colored, not the body's black.
    assert.notEqual(await sixth.evaluate((element) => getComputedStyle(element).color), 'rgb(0, 0, 0)')
    await page.keyboard.press(`${mod}+Alt+0`)
    await flow.locator('p.docx-ps-Normal', { hasText: 'Fourth level' }).waitFor()
    await page.keyboard.press(`${mod}+Alt+1`)
    await page.keyboard.press(`${mod}+b`)
    await clickEnd('Fourth level', 0, 6)
    await page.keyboard.press(`${mod}+b`)
    assert.equal(await page.evaluate(() => window.harness.editors[0].state().bold), true)
    await page.keyboard.press('Control+Space')
    assert.deepEqual(await page.evaluate(() => { const state = window.harness.editors[0].state(); return [state.styleId, state.bold] }), ['Heading1', false])
  })

  await step('pastes and drops picture files where they land, and refuses formats Word cannot show', async () => {
    await open('?file=basic-formatting.docx')
    await clickEnd('Hanging indent.')
    await page.evaluate(() => {
      window.refused = []
      window.harness.editors[0].on('imageRefused', (image) => window.refused.push(image))
    })
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const before = await flow.locator('.docx-drawing').count()
    await page.evaluate((png) => {
      const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0))
      const data = new DataTransfer()
      data.items.add(new File([bytes], 'screenshot.png', { type: 'image/png' }))
      window.harness.editors[0].view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, png)
    await page.waitForFunction((count) => document.querySelectorAll('.docx-flow .docx-drawing').length === count + 1, before)
    assert.ok((await paragraph('Hanging indent.').locator('.docx-drawing').count()) === 1)
    const target = await paragraph('Line spacing single').boundingBox()
    await page.evaluate(({ png, x, y }) => {
      const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0))
      const data = new DataTransfer()
      data.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'logo.svg', { type: 'image/svg+xml' }))
      data.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }))
      const flow = window.harness.editors[0].view.dom
      flow.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, clientX: x, clientY: y, bubbles: true, cancelable: true }))
      flow.dispatchEvent(new DragEvent('drop', { dataTransfer: data, clientX: x, clientY: y, bubbles: true, cancelable: true }))
    }, { png, x: target.x + 20, y: target.y + target.height / 2 })
    await page.waitForFunction((count) => document.querySelectorAll('.docx-flow .docx-drawing').length === count + 2, before)
    assert.equal(await paragraph('Line spacing single').locator('.docx-drawing').count(), 1)
    assert.deepEqual(await page.evaluate(() => window.refused), [{ name: 'logo.svg', type: 'image/svg+xml', reason: 'unsupported' }])
    const files = unzipSync(new Uint8Array(Buffer.from(await page.evaluate(() => window.harness.exportFile()), 'base64')))
    assert.ok(Object.keys(files).some((path) => path.startsWith('word/media/')))
  })

  await step('creates headers and footers with page numbers on every page', async () => {
    await open('?generate=80')
    const pages = await page.evaluate(() => window.harness.editors[0].pages)
    assert.ok(pages > 2)
    assert.equal(await page.evaluate(() => window.harness.editors[0].insertPageNumber({ kind: 'footer', align: 'center' })), true)
    await page.keyboard.press('Escape')
    await page.locator('.docx-story-editor').waitFor({ state: 'detached' })
    const footers = await page.locator('.docx-band .docx-story[data-story^="footer:"]').allInnerTexts()
    assert.deepEqual(footers.map((text) => text.trim()), Array.from({ length: pages }, (_, index) => String(index + 1)))
    assert.equal(await page.locator('.docx-band .docx-story[data-story^="footer:"] p').first().evaluate((element) => getComputedStyle(element).textAlign), 'center')
    await clickEnd('Section 2')
    assert.equal(await page.evaluate(() => window.harness.editors[0].addHeaderFooter('header') !== null), true)
    await page.locator('.docx-story-editor').waitFor()
    await page.keyboard.type('Running head')
    await page.keyboard.press('Escape')
    await page.locator('.docx-band .docx-story[data-story^="header:"]', { hasText: 'Running head' }).nth(pages - 1).waitFor()
    assert.match(await exported('header'), /Running head/)
    assert.match(await exported('footer'), /^1$/)
    await page.evaluate(() => window.harness.editors[0].setMode('suggesting'))
    assert.equal(await page.evaluate(() => window.harness.editors[0].addHeaderFooter('footer', 'first')), null)
  })

  await step('changes page setup, repaginates, and undoes it', async () => {
    await open('?generate=80')
    const metrics = () => page.evaluate(() => {
      const sheet = document.querySelector('.docx-page').getBoundingClientRect()
      return { pages: window.harness.editors[0].pages, width: sheet.width, height: sheet.height }
    })
    const before = await metrics()
    assert.ok(before.height > before.width)
    await clickEnd('Section 3')
    assert.equal(await page.evaluate(() => window.harness.editors[0].setPageSetup({ width: 595.3, height: 841.9, orientation: 'landscape' })), true)
    await page.waitForFunction(() => { const sheet = document.querySelector('.docx-page').getBoundingClientRect(); return sheet.width > sheet.height })
    assert.deepEqual(await page.evaluate(() => { const setup = window.harness.editors[0].pageSetup(); return [setup.width, setup.height, setup.orientation] }), [841.9, 595.3, 'landscape'])
    const landscape = await metrics()
    // Deep margins leave less text per page, so the document grows.
    assert.equal(await page.evaluate(() => window.harness.editors[0].setPageSetup({ margins: { top: 180, bottom: 180 } })), true)
    await page.waitForFunction((pages) => window.harness.editors[0].pages > pages, landscape.pages)
    await page.keyboard.press(`${mod}+z`)
    await page.waitForFunction((pages) => window.harness.editors[0].pages === pages, landscape.pages)
    await page.keyboard.press(`${mod}+z`)
    await page.waitForFunction(() => { const sheet = document.querySelector('.docx-page').getBoundingClientRect(); return sheet.height > sheet.width })
    assert.equal((await metrics()).pages, before.pages)
    const current = await page.evaluate(() => window.harness.editors[0].currentPage())
    assert.ok(current.index >= 1 && current.count === before.pages, JSON.stringify(current))
  })

  await step('shows the page of the cursor and counts the selection', async () => {
    await open('?generate=80')
    await clickEnd('Section 4')
    const current = await page.evaluate(() => window.harness.editors[0].currentPage())
    assert.ok(current.index > 1 && current.index <= current.count, JSON.stringify(current))
    assert.equal(current.number, current.index)
    await clickEnd('Section 4', 0, 1)
    assert.deepEqual(await page.evaluate(() => window.harness.editors[0].wordCount('selection').words), 1)
  })

  await step('paints a copied format onto the next mouse selection', async () => {
    await open('?file=basic-formatting.docx')
    await clickEnd('A normal paragraph with plain text', 0, 5)
    await page.keyboard.press(`${mod}+b`)
    await page.getByRole('button', { name: 'Format painter' }).click()
    assert.equal(await page.evaluate(() => document.querySelector('.docx-editor').classList.contains('docx-painting')), true)
    const target = paragraph('Line spacing single')
    const box = await target.boundingBox()
    await page.mouse.move(box.x + 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 5 })
    await page.mouse.up()
    await target.locator('span[style*="font-weight: 700"]').first().waitFor()
    await page.waitForFunction(() => !document.querySelector('.docx-editor').classList.contains('docx-painting'))
    await page.locator('button[aria-label="Format painter"][aria-pressed="false"]').waitFor()
    await page.evaluate(() => window.harness.editors[0].formatPainter({ sticky: true }))
    await paragraph('Line spacing double').click()
    await paragraph('Line spacing 1.5').click()
    assert.equal(await page.evaluate(() => window.harness.editors[0].state().formatPainter), true)
    await page.keyboard.press('Escape')
    assert.equal(await page.evaluate(() => window.harness.editors[0].state().formatPainter), false)
    assert.equal(await paragraph('Line spacing double').locator('span[style*="font-weight: 700"]').count() > 0, true)
  })

  await step('describes what is under the pointer and pastes host clipboard data through Ctrl+V', async () => {
    await open('?file=notes-fields.docx')
    const link = flow.locator('a[href="https://example.com/"]').first()
    const box = await link.boundingBox()
    const context = await page.evaluate(({ x, y }) => window.harness.editors[0].contextAt(x, y, { select: true }), { x: box.x + 3, y: box.y + box.height / 2 })
    assert.equal(context.link.href, 'https://example.com/')
    assert.equal(context.table, false)
    await open('?file=tables.docx')
    const cell = flow.locator('td.docx-cell').first()
    const cellBox = await cell.boundingBox()
    assert.equal(await page.evaluate(({ x, y }) => window.harness.editors[0].contextAt(x, y).table, { x: cellBox.x + 5, y: cellBox.y + 5 }), true)
    await open('?file=basic-formatting.docx')
    await clickEnd('A normal paragraph with plain text', 0, 5)
    await page.keyboard.press(`${mod}+b`)
    const copy = await page.evaluate(() => {
      const data = new DataTransfer()
      window.harness.editors[0].view.dom.dispatchEvent(new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
      return { html: data.getData('text/html'), text: data.getData('text/plain') }
    })
    await clickEnd('Line spacing single')
    assert.equal(await page.evaluate((copy) => window.harness.editors[0].pasteData(copy), copy), true)
    await paragraph('Line spacing single').locator('span[style*="font-weight: 700"]', { hasText: copy.text }).waitFor()
    await clickEnd('Line spacing double')
    await page.evaluate((copy) => window.harness.editors[0].pasteData(copy, { plain: true }), copy)
    assert.match(await paragraph('Line spacing double').innerText(), new RegExp(`${copy.text}$`))
    assert.equal(await paragraph('Line spacing double').locator('span[style*="font-weight: 700"]').count(), 0)
  })

  await step('lays out a 100-page document within budget', async () => {
    const started = Date.now()
    await open('?generate=1600')
    const loadTime = Date.now() - started
    const pages = await page.evaluate(() => window.harness.editors[0].pages)
    assert.ok(pages >= 80, `expected about 100 pages, got ${pages}`)
    const relayout = await page.evaluate(() => {
      const begin = performance.now()
      window.harness.editors[0].relayout()
      return performance.now() - begin
    })
    // Typing latency: time from a keystroke to the next frame.
    await paragraph('Section 40').click()
    const typing = await page.evaluate(async () => {
      const times = []
      for (let index = 0; index < 10; index++) {
        const begin = performance.now()
        document.execCommand('insertText', false, 'x')
        await new Promise((resolve) => requestAnimationFrame(() => resolve()))
        times.push(performance.now() - begin)
      }
      return times.sort((a, b) => a - b)[5]
    })
    results.push(`  ${pages} pages: load ${loadTime} ms, layout ${Math.round(relayout)} ms, typing ${Math.round(typing)} ms per key (median)`)
    assert.ok(loadTime < 20_000, `load took ${loadTime} ms`)
    assert.ok(relayout < 4_000, `layout took ${relayout} ms`)
    assert.ok(typing < 120, `typing took ${typing} ms per key`)
  })

  if (screenshots) {
    for (const [name, query] of [['docx-tables-dark', '?file=tables.docx&dark=1'], ['docx-review', '?file=review.docx'], ['docx-objects', '?file=objects.docx']]) {
      await open(query)
      await page.screenshot({ path: `${screenshots}/${name}.png` })
    }
  }
  assert.deepEqual(errors, [])
  console.log(`docx editor:\n${results.map((line) => `  ✓ ${line}`).join('\n')}`)
} finally {
  await browser?.close()
  await server?.close()
}
