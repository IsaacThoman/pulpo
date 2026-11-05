// Run with: npm run test:docx-editor -w @pulpo/web (build @pulpo/client-core first)
// Install the browser once with: npx playwright install chromium
// Set SCREENSHOT_DIR to also save screenshots (light and dark).
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import * as Y from 'yjs'
import { docxCodec, MemoryAssetStore } from '@pulpo/client-core/office/docx'

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
  const exported = async () => {
    const base64 = await page.evaluate(() => window.harness.exportFile())
    const doc = new Y.Doc()
    await docxCodec.importFile(doc, new Uint8Array(Buffer.from(base64, 'base64')), { name: 'a.docx', assets: new MemoryAssetStore() })
    return docxCodec.toText(doc)
  }

  await step('loads a document into pages with headers and fields', async () => {
    await open('?file=sections-headers.docx')
    assert.ok(await page.locator('.docx-page').count() >= 2)
    await page.locator('.docx-story', { hasText: 'First-page header' }).waitFor()
    await page.locator('.docx-story', { hasText: /page i of \d/ }).first().waitFor()
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
      localStorage.setItem('pulpo-docx-copy', JSON.stringify({ id, json: JSON.stringify(slice) }))
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
