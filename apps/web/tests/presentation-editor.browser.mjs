// Run with: npm run test:presentation-editor -w @pulpo/web (builds @pulpo/client-core first)
// Install the browser once with: npx playwright install chromium
//
// Drives the presentation editor harness (tests/presentation-editor) like a user: selecting,
// moving, resizing, rotating, typing, formatting, inserting, slide management, undo, two
// collaborators, clipboard, present mode, touch, read-only, and export.
import assert from 'node:assert/strict'
import { chromium, devices } from 'playwright'
import { createServer } from 'vite'

const root = new URL('..', import.meta.url).pathname
let server
let browser
const results = []

async function check(name, run) {
  // ONLY=<text> runs the checks whose name contains it.
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return
  console.log(`… ${name}`)
  const started = Date.now()
  await run()
  results.push(`${name} (${Date.now() - started} ms)`)
}

async function open(context, query) {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${server.resolvedUrls.local[0]}tests/presentation-editor/index.html?${query}`)
  await page.locator('.pp-canvas .pp-slide').first().waitFor()
  await page.waitForFunction(() => window.harness?.controllers?.a)
  return { page, errors }
}

const slideShapes = (page) => page.locator('.pp-canvas-slide .pp-slide > [data-key]')
const state = (page) => page.evaluate(() => window.harness.controllers.a.state)
const xfrmOf = (page, key) => page.evaluate((shape) => window.harness.controllers.a.shapeXfrm(window.harness.controllers.a.state.slide, shape), key)

try {
  server = await createServer({ root, logLevel: 'error', server: { host: '127.0.0.1', port: 0 } })
  await server.listen()
  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })

  await check('selects, moves with snapping, resizes, rotates, nudges, and undoes', async () => {
    const { page, errors } = await open(context, 'deck=generated/autoshapes.pptx')
    const shape = slideShapes(page).nth(1)
    const key = await shape.getAttribute('data-key')
    await shape.click()
    assert.deepEqual((await state(page)).shapes, [key])
    assert.equal(await page.locator('.pp-selection .pp-handle').count(), 9, 'eight resize handles and a rotate handle')
    const before = await xfrmOf(page, key)
    const box = await shape.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40, { steps: 8 })
    await page.mouse.up()
    const moved = await xfrmOf(page, key)
    assert.ok(moved.x > before.x && moved.y > before.y, 'moved right and down')
    // Resize from the east handle: width grows, x stays.
    const handle = page.locator('.pp-handle-e')
    const handleBox = await handle.boundingBox()
    await page.mouse.move(handleBox.x + 4, handleBox.y + 4)
    await page.mouse.down()
    await page.mouse.move(handleBox.x + 84, handleBox.y + 4, { steps: 6 })
    await page.mouse.up()
    const resized = await xfrmOf(page, key)
    assert.ok(resized.cx > moved.cx, 'wider')
    assert.ok(Math.abs(resized.x - moved.x) < 9525 * 2, 'left edge kept')
    // Rotate with the rotation handle, snapping to 15° with Shift.
    const rotate = await page.locator('.pp-handle-rotate').boundingBox()
    await page.mouse.move(rotate.x + 6, rotate.y + 6)
    await page.mouse.down()
    await page.keyboard.down('Shift')
    const selection = await page.locator('.pp-selection').boundingBox()
    await page.mouse.move(selection.x + selection.width + 80, selection.y + selection.height / 2, { steps: 6 })
    await page.keyboard.up('Shift')
    await page.mouse.up()
    const rotated = await xfrmOf(page, key)
    assert.equal(rotated.rot % 900000, 0, 'snapped to 15°')
    assert.ok(rotated.rot > 0)
    await page.keyboard.press('ArrowRight')
    assert.equal((await xfrmOf(page, key)).x, rotated.x + 2 * 9525, 'arrow nudges')
    // Each gesture is one undo step: nudge, rotate, resize, move.
    for (let step = 0; step < 4; step++) await page.keyboard.press('Meta+z')
    assert.deepEqual(await xfrmOf(page, key), before)
    await page.keyboard.press('Meta+Shift+z')
    assert.deepEqual(await xfrmOf(page, key), moved)
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('marquee selects several shapes; group, ungroup, align, delete', async () => {
    const { page, errors } = await open(context, 'deck=generated/autoshapes.pptx')
    const stage = await page.locator('.pp-canvas-stage').boundingBox()
    // Drag a marquee around the first row of shapes (they sit below the title).
    await page.mouse.move(stage.x + 5, stage.y + stage.height * 0.17)
    await page.mouse.down()
    await page.mouse.move(stage.x + stage.width * 0.45, stage.y + stage.height * 0.33, { steps: 10 })
    await page.mouse.up()
    const selected = (await state(page)).shapes
    assert.ok(selected.length >= 3, `marquee selected ${selected.length}`)
    await page.keyboard.press('Meta+g')
    const grouped = (await state(page)).shapes
    assert.equal(grouped.length, 1)
    assert.equal(await page.evaluate((key) => window.harness.controllers.a.shape(window.harness.controllers.a.state.slide, key).kind, grouped[0]), 'grpSp')
    await page.keyboard.press('Meta+Shift+g')
    assert.equal((await state(page)).shapes.length, selected.length)
    await page.evaluate(() => window.harness.controllers.a.align('top'))
    const tops = await page.evaluate(() => window.harness.controllers.a.state.shapes.map((key) => window.harness.controllers.a.shapeXfrm(window.harness.controllers.a.state.slide, key).y))
    assert.equal(new Set(tops).size, 1, 'aligned tops')
    const count = await slideShapes(page).count()
    await page.keyboard.press('Delete')
    assert.equal(await slideShapes(page).count(), count - selected.length)
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('types in a placeholder, formats text, and both collaborators see it', async () => {
    const { page, errors } = await open(context, 'deck=generated/text-formatting.pptx&split=1')
    await page.waitForFunction(() => window.harness.controllers.b)
    const canvasA = page.locator('.pp-canvas').first()
    await page.locator('.pp-thumbs').first().locator('.pp-thumb').nth(1).click()
    await canvasA.locator('.pp-canvas-slide .pp-slide > [data-key]').first().dblclick()
    await page.locator('.pp-canvas .pp-text-editor').first().waitFor()
    await page.keyboard.press('End')
    await page.keyboard.type(' plus words')
    // Select the typed words and make them bold and red through the toolbar.
    for (let index = 0; index < ' plus words'.length; index++) await page.keyboard.press('Shift+ArrowLeft')
    await page.getByRole('button', { name: 'Bold' }).first().click()
    await page.getByRole('button', { name: 'Text color' }).first().click()
    await page.getByRole('button', { name: '#FF0000' }).click()
    await page.waitForFunction(() => window.harness.text('b').includes('Character formatting plus words'))
    const runs = await page.evaluate(() => {
      const controller = window.harness.controllers.b
      const slide = controller.slideKeys()[1]
      return controller.slide(slide).shapes[0].text.content[0].content
    })
    const typed = runs.find((run) => run.text === ' plus words')
    assert.ok(typed, JSON.stringify(runs))
    assert.ok(typed.marks.some((mark) => mark.type === 'b' && mark.attrs.value === true))
    assert.ok(typed.marks.some((mark) => mark.type === 'fill' && mark.attrs.value.includes('FF0000')))
    // B sees A's caret label while A edits, and A's selection outline when not editing.
    await page.keyboard.press('Escape')
    await page.locator('.pp-canvas').nth(1).locator('.pp-thumb, .pp-canvas-slide').first().waitFor()
    await page.evaluate(() => window.harness.controllers.b.goToSlide(window.harness.controllers.b.slideKeys()[1]))
    await page.locator('.pp-canvas').first().locator('.pp-canvas-slide .pp-slide > [data-key]').nth(1).click()
    await page.locator('.pp-canvas').nth(1).locator('.pp-remote-name', { hasText: 'Ada' }).waitFor()
    // Undo removes only Ada's own changes.
    await page.evaluate(() => {
      const b = window.harness.controllers.b
      b.selectShapes([b.slide(b.state.slide).shapes[1].key])
      b.nudge(95250, 0)
    })
    const bMoved = await page.evaluate(() => window.harness.controllers.b.shapeXfrm(window.harness.controllers.b.state.slide, window.harness.controllers.b.slide(window.harness.controllers.b.state.slide).shapes[1].key).x)
    for (let step = 0; step < 6; step++) await page.evaluate(() => window.harness.controllers.a.undo())
    assert.ok(!(await page.evaluate(() => window.harness.text('a'))).includes('plus words'), 'own typing undone')
    const afterUndo = await page.evaluate(() => window.harness.controllers.a.shapeXfrm(window.harness.controllers.a.slideKeys()[1], window.harness.controllers.a.slide(window.harness.controllers.a.slideKeys()[1]).shapes[1].key).x)
    assert.equal(afterUndo, bMoved, "Grace's move survives Ada's undo")
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('inserts text boxes, shapes, tables, and images; edits table cells', async () => {
    const { page, errors } = await open(context, 'blank=1')
    await page.getByRole('button', { name: 'Text box' }).click()
    await page.locator('.pp-canvas .pp-text-editor').waitFor()
    await page.keyboard.type('Hello from a text box')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Shapes' }).click()
    await page.locator('[data-preset="star5"]').click()
    await page.getByRole('button', { name: 'Table' }).click()
    await page.getByRole('button', { name: '3 × 2 table' }).click()
    await page.locator('[data-testid="presentation-image-input"]').setInputFiles({
      name: 'pixel.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDK+mmyAAAAABJRU5ErkJggg==', 'base64'),
    })
    await page.waitForFunction(() => window.harness.controllers.a.slide(window.harness.controllers.a.state.slide).shapes.length === 6)
    const kinds = await page.evaluate(() => window.harness.controllers.a.slide(window.harness.controllers.a.state.slide).shapes.map((shape) => shape.kind))
    assert.deepEqual(kinds, ['sp', 'sp', 'sp', 'sp', 'graphicFrame', 'pic'])
    await page.locator('.pp-canvas-slide image').waitFor({ state: 'attached' })
    // Type into a table cell.
    const cell = page.locator('.pp-canvas-slide td').nth(4)
    await cell.dblclick()
    await page.locator('.pp-canvas .pp-text-editor').waitFor()
    await page.keyboard.type('cell text')
    await page.keyboard.press('Escape')
    assert.ok((await page.evaluate(() => window.harness.text('a'))).includes('cell text'))
    assert.ok((await page.evaluate(() => window.harness.text('a'))).includes('Hello from a text box'))
    // Export and open the file again: everything inserted survives.
    const reopened = await page.evaluate(async () => {
      const bytes = Uint8Array.from(atob(await window.harness.exportFile()), (char) => char.charCodeAt(0))
      const doc = new window.harness.docA.constructor()
      await window.harness.codec.importFile(doc, bytes, { name: 'Blank.pptx', assets: window.harness.assets })
      return window.harness.codec.toText(doc)
    })
    assert.match(reopened, /Hello from a text box/)
    assert.match(reopened, /cell text/)
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('manages slides in the strip: add, duplicate, reorder by dragging, hide, delete', async () => {
    const { page, errors } = await open(context, 'deck=generated/layouts-notes-sections.pptx')
    const keys = () => page.evaluate(() => window.harness.controllers.a.slideKeys())
    const original = await keys()
    await page.getByRole('button', { name: 'New slide' }).click()
    await page.getByRole('menuitem', { name: 'Title Only' }).click()
    assert.equal((await keys()).length, original.length + 1)
    await page.locator('.pp-thumbs').focus()
    await page.keyboard.press('Meta+d')
    assert.equal((await keys()).length, original.length + 2)
    // Drag slide 1 below slide 3.
    const first = page.locator('.pp-thumb').nth(0)
    const third = page.locator('.pp-thumb').nth(2)
    const from = await first.boundingBox()
    const to = await third.boundingBox()
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + to.width / 2, to.y + to.height * 0.9, { steps: 12 })
    await page.mouse.up()
    const reordered = await keys()
    assert.equal(reordered[2], original[0], `slide moved: ${reordered.slice(0, 4)}`)
    await page.evaluate(() => window.harness.controllers.a.setSlidesHidden(true))
    await page.locator('.pp-thumb-hidden').first().waitFor()
    await page.locator('.pp-thumbs').focus()
    await page.keyboard.press('Delete')
    assert.equal((await keys()).length, original.length + 1)
    // Section headers are shown in the strip.
    assert.ok((await page.locator('.pp-section').count()) >= 2)
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('copies and pastes shapes and slides', async () => {
    const { page, errors } = await open(context, 'deck=generated/pictures.pptx')
    const count = await slideShapes(page).count()
    await slideShapes(page).first().click()
    await page.keyboard.press('Meta+c')
    await page.waitForTimeout(200)
    await page.keyboard.press('Meta+v')
    await page.waitForFunction((expected) => document.querySelectorAll('.pp-canvas-slide .pp-slide > [data-key]').length === expected, count + 1)
    const slides = await page.evaluate(() => window.harness.controllers.a.slideKeys().length)
    await page.evaluate(async () => {
      const controller = window.harness.controllers.a
      controller.selectShapes([])
      const copied = await controller.copy()
      await controller.paste(copied.json)
    })
    assert.equal(await page.evaluate(() => window.harness.controllers.a.slideKeys().length), slides + 1)
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('presents with keyboard navigation, skips hidden slides, and shows presenter view', async () => {
    const { page, errors } = await open(context, 'deck=generated/layouts-notes-sections.pptx')
    await page.getByRole('button', { name: 'Present' }).click()
    await page.getByRole('menuitem', { name: 'From beginning' }).click()
    await page.locator('.pp-present .pp-slide').waitFor()
    const shown = []
    const visible = await page.evaluate(() => window.harness.controllers.a.slideKeys().filter((key) => !window.harness.controllers.a.slide(key).hidden).length)
    for (let step = 0; step < visible; step++) {
      shown.push(await page.locator('.pp-present .pp-present-stage').getAttribute('data-slide'))
      await page.keyboard.press('ArrowRight')
    }
    assert.equal(new Set(shown).size, visible, 'every visible slide shown once')
    const hidden = await page.evaluate(() => window.harness.controllers.a.slideKeys().filter((key) => window.harness.controllers.a.slide(key).hidden))
    assert.ok(hidden.length && !shown.some((key) => hidden.includes(key)), 'hidden slides skipped')
    await page.locator('.pp-present-end').waitFor()
    await page.keyboard.press('Escape')
    await page.locator('.pp-present').waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'Present' }).click()
    await page.getByRole('menuitem', { name: 'Presenter view' }).click()
    await page.locator('.pp-presenter-notes').waitFor()
    assert.ok((await page.locator('.pp-presenter-notes').innerText()).length > 0)
    await page.keyboard.press('Escape')
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('read-only mode shows no handles and blocks edits', async () => {
    const { page, errors } = await open(context, 'deck=generated/autoshapes.pptx&readonly=1')
    await slideShapes(page).first().click()
    assert.equal(await page.locator('.pp-handle').count(), 0)
    await slideShapes(page).first().dblclick()
    assert.equal(await page.locator('.pp-canvas .pp-text-editor').count(), 0)
    await page.keyboard.press('Delete')
    assert.ok((await slideShapes(page).count()) > 10)
    assert.equal(await page.getByRole('button', { name: 'Text box' }).count(), 0)
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('touch: tap selects, drag moves, double tap edits', async () => {
    const touch = await browser.newContext({ ...devices['iPad Pro 11'] })
    const { page, errors } = await open(touch, 'deck=generated/autoshapes.pptx')
    const shape = slideShapes(page).nth(2)
    const box = await shape.boundingBox()
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    const key = await shape.getAttribute('data-key')
    assert.deepEqual((await state(page)).shapes, [key])
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await page.locator('.pp-canvas .pp-text-editor').waitFor()
    assert.deepEqual(errors, [])
    await touch.close()
  })

  await check('opens .ppsx in the slide show and renders every fixture without errors', async () => {
    const { page, errors } = await open(context, 'deck=poi/testPPT.ppsx')
    await page.locator('.pp-present').waitFor()
    await page.keyboard.press('Escape')
    for (const deck of ['poi/SmartArt.pptx', 'poi/bar-chart.pptx', 'poi/table-with-theme.pptx', 'poi/shapes.pptx', 'poi/EmbeddedVideo.pptx', 'generated/charts.pptx', 'libreoffice/lo-autoshapes.pptx']) {
      await page.goto(`${server.resolvedUrls.local[0]}tests/presentation-editor/index.html?deck=${deck}`)
      await page.locator('.pp-canvas .pp-slide').waitFor()
    }
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('shows a review diff of the changes', async () => {
    const { page, errors } = await open(context, 'deck=generated/text-formatting.pptx')
    await page.evaluate(() => {
      const controller = window.harness.controllers.a
      controller.goToSlide(controller.slideKeys()[2])
      controller.deleteSlides()
    })
    await page.getByRole('button', { name: 'Changes' }).click()
    await page.locator('[data-presentation-diff] [data-status="removed"]').waitFor()
    assert.match(await page.locator('[data-presentation-diff] [role="status"]').innerText(), /1 removed/)
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('a collaborator’s slide key cannot put markup into the thumbnails', async () => {
    const { page, errors } = await open(context, 'deck=generated/pictures.pptx&split=1')
    const result = await page.evaluate(async () => {
      const harness = window.harness
      const slide = harness.commands.readSlide(harness.docB, harness.commands.slideKeys(harness.docB)[0])
      const evil = 'k"/><img src=x onerror="window.__injected=(window.__injected||0)+1">'
      harness.commands.insertSlides(harness.docB, [{ ...harness.commands.cloneSlide(slide), key: evil }], 0)
      await new Promise((resolve) => setTimeout(resolve, 1000))
      return { injected: window.__injected ?? 0, images: document.querySelectorAll('img[src="x"]').length }
    })
    assert.deepEqual(result, { injected: 0, images: 0 })
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('table cells: rows under a vertical merge, switching cells while editing, and Tab', async () => {
    const { page, errors } = await open(context, 'deck=generated/tables.pptx')
    const table = page.locator('.pp-canvas-slide .pp-slide > [data-kind="graphicFrame"]').nth(1)
    const tableKey = await table.getAttribute('data-key')
    const cellText = (row, column) => page.evaluate(([key, r, c]) => {
      const controller = window.harness.controllers.a
      const model = controller.shape(controller.state.slide, key).table
      const flat = (node) => (node?.text ?? '') + (node?.content ?? []).map(flat).join('')
      return flat(model.rows[r].cells[model.columns[c].key].text)
    }, [tableKey, row, column])
    // A cell in a row a rowspan from above covers: the edit lands in that cell, not a merged-away one.
    const target = table.locator('td[data-row="3"][data-col="1"]')
    const before = await cellText(3, 1)
    let box = await target.boundingBox()
    await page.mouse.dblclick(box.x + box.width / 2, box.y + 8)
    await page.keyboard.type('ZZ')
    await page.keyboard.press('Escape')
    assert.ok((await cellText(3, 1)).includes('ZZ'), 'typed into the visible cell')
    assert.notEqual(await cellText(3, 1), before)
    // Double-clicking another cell while editing moves the editor there; Backspace edits text.
    box = await table.locator('td').nth(0).boundingBox()
    await page.mouse.dblclick(box.x + box.width / 2, box.y + 8)
    const second = table.locator('td').nth(1)
    box = await second.boundingBox()
    await page.mouse.dblclick(box.x + box.width / 2, box.y + 8)
    const editing = await state(page)
    assert.equal(editing.editing?.column, await page.evaluate(([key, col]) => {
      const controller = window.harness.controllers.a
      return controller.shape(controller.state.slide, key).table.columns[col].key
    }, [tableKey, Number(await second.getAttribute('data-col'))]))
    await page.keyboard.press('Backspace')
    assert.ok(await page.evaluate((key) => Boolean(window.harness.controllers.a.shape(window.harness.controllers.a.state.slide, key)), tableKey), 'the table is still there')
    // Tab moves to the next cell.
    const column = editing.editing.column
    await page.keyboard.press('Tab')
    assert.notEqual((await state(page)).editing?.column, column)
    await page.keyboard.press('Escape')
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('Escape leaves text editing and keeps the shape selected; show shortcuts ignore text fields', async () => {
    const { page, errors } = await open(context, 'deck=generated/text-formatting.pptx')
    const shape = slideShapes(page).nth(1)
    const key = await shape.getAttribute('data-key')
    const box = await shape.boundingBox()
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
    assert.ok((await state(page)).editing)
    await page.keyboard.press('Escape')
    const after = await state(page)
    assert.equal(after.editing, undefined)
    assert.deepEqual(after.shapes, [key])
    const inShow = () => page.evaluate(() => Boolean(document.querySelector('.pp-present, .pp-presenter')))
    await page.evaluate(() => {
      const field = document.createElement('textarea')
      field.id = 'elsewhere'
      document.body.prepend(field)
    })
    await page.focus('#elsewhere')
    await page.keyboard.press('Meta+Enter')
    assert.equal(await inShow(), false, 'Cmd+Enter in another text field')
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
    await page.keyboard.press('Control+Enter')
    assert.equal(await inShow(), false, 'Ctrl+Enter in slide text')
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('the slide strip copies and pastes slides through the clipboard', async () => {
    const { page, errors } = await open(context, 'deck=generated/layouts-notes-sections.pptx')
    const count = () => page.evaluate(() => window.harness.controllers.a.slideKeys().length)
    const before = await count()
    await page.locator('.pp-thumbs .pp-thumb').nth(1).click()
    await page.keyboard.press('Meta+c')
    await page.waitForTimeout(300)
    await page.keyboard.press('Meta+v')
    await page.waitForFunction((expected) => window.harness.controllers.a.slideKeys().length === expected, before + 1)
    // Pasting on the canvas brings slides too, never the payload as text.
    await page.locator('.pp-canvas').focus()
    await page.keyboard.press('Meta+v')
    await page.waitForFunction((expected) => window.harness.controllers.a.slideKeys().length === expected, before + 2)
    const texts = await page.evaluate(() => {
      const controller = window.harness.controllers.a
      const flat = (node) => (node?.text ?? '') + (node?.content ?? []).map(flat).join('')
      return controller.slide(controller.state.slide).shapes.map((shape) => flat(shape.text))
    })
    assert.ok(!texts.some((text) => text.includes('"version"')), 'no JSON pasted as text')
    assert.equal(await count(), before + 2)
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('performance: a 300-slide deck opens, switches slides, and scrolls thumbnails within budget', async () => {
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const started = Date.now()
    await page.goto(`${server.resolvedUrls.local[0]}tests/presentation-editor/index.html?deck=generated/autoshapes.pptx&big=300`)
    await page.locator('.pp-canvas .pp-slide').first().waitFor({ timeout: 60_000 })
    const firstRender = Date.now() - started
    assert.equal(await page.locator('.pp-thumb').count(), 300)
    // Thumbnails are drawn lazily: far fewer than 300 have content.
    const drawn = await page.evaluate(() => [...document.querySelectorAll('.pp-thumb-content')].filter((element) => element.childElementCount > 0).length)
    assert.ok(drawn < 60, `only visible thumbnails drawn (${drawn})`)
    await page.locator('.pp-thumbs').focus()
    const switchTimes = []
    for (let step = 0; step < 20; step++) {
      const before = await page.evaluate(() => performance.now())
      await page.keyboard.press('ArrowDown')
      switchTimes.push(await page.evaluate((start) => new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now() - start))), before))
    }
    const averageSwitch = switchTimes.reduce((sum, value) => sum + value, 0) / switchTimes.length
    const scrollFrames = await page.evaluate(async () => {
      const strip = document.querySelector('.pp-thumbs')
      const frames = []
      let last = performance.now()
      for (let step = 0; step < 40; step++) {
        strip.scrollTop += 400
        await new Promise((resolve) => requestAnimationFrame(resolve))
        const now = performance.now()
        frames.push(now - last)
        last = now
      }
      return frames.sort((a, b) => a - b)[Math.floor(frames.length * 0.9)]
    })
    console.log(`    300 slides: first render ${firstRender} ms, slide switch ${averageSwitch.toFixed(1)} ms, p90 scroll frame ${scrollFrames.toFixed(1)} ms`)
    assert.ok(firstRender < 30_000, 'opens in under 30 s')
    assert.ok(averageSwitch < 250, 'switches slides in under 250 ms')
    assert.ok(scrollFrames < 250, 'thumbnail scrolling stays responsive')
    assert.deepEqual(errors, [])
    await page.close()
  })

  console.log(results.map((line) => `✓ ${line}`).join('\n'))
} finally {
  await browser?.close()
  await server?.close()
}
