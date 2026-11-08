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

async function openVideo(context, mode, twoSlides = false) {
  const { page, errors } = await open(context, 'deck=poi/EmbeddedVideo.pptx')
  if (twoSlides) await page.evaluate(() => window.harness.commands.duplicateSlides(window.harness.docA, window.harness.controllers.a.slideKeys()))
  if (mode !== 'canvas') {
    await page.getByRole('button', { name: 'Present options', exact: true }).click()
    await page.getByRole('menuitem', { name: mode === 'show' ? 'From beginning' : 'Presenter view', exact: true }).click()
  }
  const root = mode === 'canvas' ? '.pp-canvas' : mode === 'show' ? '.pp-present' : '.pp-presenter-current-wrap'
  const button = page.locator(`${root} .pp-media`).first()
  await button.waitFor()
  return { page, errors, root, button }
}

async function delayVideo(button) {
  return button.evaluate((button) => {
    const shape = button.closest('[data-key]')
    const { offsetLeft: left, offsetTop: top, offsetWidth: width, offsetHeight: height } = shape
    // Delay the asset store, as the mobile bridge or a download would, until after the click.
    const assets = window.harness.assets
    const get = assets.get.bind(assets)
    assets.get = (hash) => {
      window.mediaRequested = true
      window.mediaLoadFinished = new Promise((resolve) => { window.releaseMedia = resolve }).then(() => get(hash))
      return window.mediaLoadFinished
    }
    window.mediaShape = shape
    return { left, top, width, height }
  })
}

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
    await page.getByRole('button', { name: 'Red', exact: true }).click()
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

  await check('puts the caret where you click: double click selects the word, a second click edits at the pointer', async () => {
    const { page, errors } = await open(context, 'deck=generated/text-formatting.pptx')
    await page.locator('.pp-thumbs .pp-thumb').nth(1).click()
    const box = slideShapes(page).nth(1)
    const key = await box.getAttribute('data-key')
    const paragraphs = () => page.evaluate((shape) => {
      const controller = window.harness.controllers.a
      const flat = (node) => (node?.text ?? '') + (node?.content ?? []).map(flat).join('')
      return controller.shape(controller.state.slide, shape).text.content.map(flat)
    }, key)
    // Client coordinates of a word in the rendered slide.
    const wordPoint = (word) => page.evaluate(([shape, text]) => {
      const root = document.querySelector(`.pp-canvas-slide [data-key="${shape}"]`)
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const index = node.data.indexOf(text)
        if (index < 0) continue
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + 1)
        const rect = range.getBoundingClientRect()
        return { x: rect.left + 1, y: rect.top + rect.height / 2 }
      }
      return undefined
    }, [key, word])
    const before = await paragraphs()
    const arial = await wordPoint('Arial')
    await page.mouse.dblclick(arial.x + 2, arial.y)
    await page.locator('.pp-canvas .pp-text-editor').waitFor()
    await page.keyboard.type('Helvetica')
    assert.equal((await paragraphs())[1], before[1].replace('Arial', 'Helvetica'), 'the double-clicked word is replaced')
    await page.keyboard.press('Escape')
    assert.deepEqual((await state(page)).shapes, [key])
    // A click on the selected text box opens its text with the caret at the pointer.
    const roman = await wordPoint('Roman')
    await page.mouse.click(roman.x, roman.y)
    assert.ok((await state(page)).editing, 'editing after a second click')
    await page.keyboard.type('X')
    const line = (await paragraphs())[2]
    const at = before[2].indexOf('Roman')
    assert.ok(Math.abs(line.indexOf('X') - at) <= 1, `caret at the click: ${line}`)
    await page.keyboard.press('Escape')
    // A selected shape without text stays selected on a second click, so it can be dragged.
    const rect = await page.evaluate(() => window.harness.controllers.a.insertShape('rect'))
    const shape = page.locator(`.pp-canvas-slide [data-key="${rect}"]`)
    await shape.click()
    assert.equal((await state(page)).editing, undefined)
    assert.deepEqual((await state(page)).shapes, [rect])
    // A double click that opens no text (on a group) leaves no caret behind for the next editor.
    const [group, textBox] = await page.evaluate(() => {
      const controller = window.harness.controllers.a
      const first = controller.insertShape('rect', { x: 300_000, y: 3_000_000, cx: 900_000, cy: 600_000 })
      const second = controller.insertShape('ellipse', { x: 300_000, y: 4_000_000, cx: 900_000, cy: 600_000 })
      controller.selectShapes([first, second])
      controller.group()
      const grouped = controller.state.shapes[0]
      const text = controller.insertTextBox({ x: 6_000_000, y: 3_000_000, cx: 3_000_000, cy: 600_000 })
      return [grouped, text]
    })
    await page.locator('.pp-canvas .pp-text-editor').waitFor()
    await page.keyboard.type('abc')
    await page.keyboard.press('Escape')
    await page.locator(`.pp-canvas-slide [data-key="${group}"]`).dblclick({ position: { x: 20, y: 20 } })
    assert.equal((await state(page)).editing, undefined)
    await page.evaluate((key) => window.harness.controllers.a.setState({ shapes: [key], editing: { slide: window.harness.controllers.a.state.slide, shape: key } }), textBox)
    await page.locator('.pp-canvas .pp-text-editor').waitFor()
    await page.keyboard.type('Z')
    assert.equal(await page.evaluate((key) => window.harness.controllers.a.shape(window.harness.controllers.a.state.slide, key).text.content[0].content[0].text, textBox), 'abcZ', 'typing goes on at the end')
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

  await check('pastes and drops images at their aspect ratio; a drop on the slide stays out of the chat', async () => {
    const { page, errors } = await open(context, 'blank=1')
    // A 4×2 px PNG.
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAACCAIAAADwyuo0AAAAEElEQVR4nGP4z8AARwzIHABvqgf5gNwAKAAAAABJRU5ErkJggg=='
    const pictures = () => page.evaluate(() => {
      const controller = window.harness.controllers.a
      return controller.slide(controller.state.slide).shapes.filter((shape) => shape.kind === 'pic').map((shape) => ({ ...controller.shapeXfrm(controller.state.slide, shape.key), descr: shape.descr }))
    })
    await page.evaluate((base64) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const data = new DataTransfer()
      data.items.add(new File([bytes], 'image.png', { type: 'image/png' }))
      const canvas = document.querySelector('.pp-canvas')
      canvas.focus()
      canvas.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    }, png)
    await page.waitForFunction(() => window.harness.controllers.a.slide(window.harness.controllers.a.state.slide).shapes.some((shape) => shape.kind === 'pic'))
    const [pasted] = await pictures()
    assert.equal(pasted.cx / pasted.cy, 2, `pasted at 2:1, not 4:3 (${pasted.cx}×${pasted.cy})`)
    const stage = await page.locator('.pp-canvas-stage').boundingBox()
    const point = { x: stage.x + stage.width * 0.25, y: stage.y + stage.height * 0.75 }
    const reached = await page.evaluate(([base64, at]) => {
      let windowDrops = 0
      window.addEventListener('drop', () => { windowDrops++ })
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
      const data = new DataTransfer()
      data.items.add(new File([bytes], 'wide logo.png', { type: 'image/png' }))
      const target = document.elementFromPoint(at.x, at.y)
      const over = new DragEvent('dragover', { dataTransfer: data, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true })
      target.dispatchEvent(over)
      target.dispatchEvent(new DragEvent('drop', { dataTransfer: data, clientX: at.x, clientY: at.y, bubbles: true, cancelable: true }))
      return { accepted: over.defaultPrevented, windowDrops }
    }, [png, point])
    assert.deepEqual(reached, { accepted: true, windowDrops: 0 })
    await page.waitForFunction(() => window.harness.controllers.a.slide(window.harness.controllers.a.state.slide).shapes.filter((shape) => shape.kind === 'pic').length === 2)
    const dropped = (await pictures())[1]
    const size = await page.evaluate(() => window.harness.controllers.a.size())
    assert.equal(dropped.cx / dropped.cy, 2)
    assert.ok(Math.abs(dropped.x + dropped.cx / 2 - size.width * 0.25 * 9525) < 3 * 9525, 'centered on the drop point (x)')
    assert.ok(Math.abs(dropped.y + dropped.cy / 2 - size.height * 0.75 * 9525) < 3 * 9525, 'centered on the drop point (y)')
    assert.equal(dropped.descr, 'wide logo')
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('arrows keep their heads when the format panel changes the line; flips and text box options draw', async () => {
    const { page, errors } = await open(context, 'blank=1')
    const key = await page.evaluate(() => window.harness.controllers.a.insertShape('straightConnector1', { x: 1_000_000, y: 1_000_000, cx: 3_000_000, cy: 0 }, { tail: 'triangle' }))
    const line = () => page.evaluate((shape) => window.harness.controllers.a.shape(window.harness.controllers.a.state.slide, shape).line, key)
    await page.locator(`.pp-canvas-slide [data-key="${key}"] marker`).first().waitFor({ state: 'attached' })
    await page.getByRole('button', { name: 'Format panel' }).click()
    await page.getByRole('combobox', { name: 'Line width' }).selectOption('3')
    await page.getByRole('combobox', { name: 'Dash type' }).selectOption('dash')
    assert.match(await line(), /w="38100"/)
    assert.match(await line(), /<a:prstDash val="dash"\/><a:tailEnd type="triangle"\/>/)
    await page.locator(`.pp-canvas-slide [data-key="${key}"] marker`).first().waitFor({ state: 'attached' })
    const reopened = await page.evaluate(async () => {
      const bytes = Uint8Array.from(atob(await window.harness.exportFile()), (char) => char.charCodeAt(0))
      const doc = new window.harness.docA.constructor()
      await window.harness.codec.importFile(doc, bytes, { name: 'Blank.pptx', assets: window.harness.assets })
      const slides = doc.getMap('presentation').get('slides')
      return [...slides.values()].flatMap((slide) => [...slide.get('shapes').values()].map((shape) => shape.get('line') ?? '')).join('')
    })
    assert.match(reopened, /tailEnd type="triangle"/)
    // A text box has no line of its own or from a style: choosing a width draws one.
    const box = await page.evaluate(() => {
      const controller = window.harness.controllers.a
      const key = controller.insertTextBox()
      controller.setState({ editing: undefined })
      return key
    })
    await page.getByRole('combobox', { name: 'Line width' }).selectOption('3')
    const boxLine = await page.evaluate((shape) => window.harness.controllers.a.shape(window.harness.controllers.a.state.slide, shape).line, box)
    assert.match(boxLine, /w="38100"><a:solidFill><a:schemeClr val="tx1"\/><\/a:solidFill><\/a:ln>$/)
    // Flip and bottom-anchored text render.
    const title = await slideShapes(page).first().getAttribute('data-key')
    await page.evaluate((shape) => {
      const controller = window.harness.controllers.a
      controller.selectShapes([shape])
      controller.setTextAnchor('b')
      controller.selectShapes([shape])
      controller.flip('vertical')
    }, title)
    await page.locator(`.pp-canvas-slide [data-key="${title}"] .pp-text[data-anchor="b"]`).waitFor({ state: 'attached' })
    assert.equal(await page.evaluate((shape) => window.harness.controllers.a.shapeXfrm(window.harness.controllers.a.state.slide, shape).flipV, title), true)
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('manages slides in the strip: add, duplicate, reorder by dragging, hide, delete', async () => {
    const { page, errors } = await open(context, 'deck=generated/layouts-notes-sections.pptx')
    const keys = () => page.evaluate(() => window.harness.controllers.a.slideKeys())
    const original = await keys()
    await page.getByRole('button', { name: 'New slide with layout' }).click()
    await page.getByRole('menuitem', { name: 'Title Only' }).click()
    assert.equal((await keys()).length, original.length + 1)
    await page.locator('.pp-thumbs').focus()
    await page.keyboard.press('Meta+d')
    assert.equal((await keys()).length, original.length + 2)
    // Drag slide 1 below slide 3, once the rebuilt strip has drawn its thumbnails (a frame later).
    await page.waitForFunction(() => [...document.querySelectorAll('.pp-thumbs .pp-thumb-frame')].every((frame) => frame.offsetHeight > 30))
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

  await check('applying a layout adds its placeholders, reset brings back their place, and undo takes each back', async () => {
    const { page, errors } = await open(context, 'deck=generated/layouts-notes-sections.pptx')
    await page.locator('.pp-thumbs .pp-thumb').nth(6).click()
    assert.equal(await slideShapes(page).count(), 0, 'a blank slide')
    await page.getByRole('button', { name: 'Slide', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Title and Content', exact: true }).click()
    await page.locator('.pp-canvas-slide .pp-prompt').first().waitFor()
    assert.equal(await slideShapes(page).count(), 2)
    assert.deepEqual(await page.locator('.pp-canvas-slide .pp-prompt').allInnerTexts(), ['Click to add title', 'Click to add text'])
    // Move the title away, then reset the slide: it returns to the layout's place.
    const title = await slideShapes(page).first().getAttribute('data-key')
    const inherited = await xfrmOf(page, title)
    await page.evaluate((key) => {
      const controller = window.harness.controllers.a
      controller.selectShapes([key])
      controller.nudge(95250 * 5, 95250 * 3)
      controller.resetSlides()
    }, title)
    assert.deepEqual(await xfrmOf(page, title), inherited)
    await page.locator('.pp-canvas').focus()
    await page.keyboard.press('Meta+z')
    assert.notDeepEqual(await xfrmOf(page, title), inherited, 'undo takes back the reset')
    await page.keyboard.press('Meta+z')
    await page.keyboard.press('Meta+z')
    assert.equal(await slideShapes(page).count(), 0, 'undo takes back the layout and its placeholders')
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

  for (const action of ['copy', 'cut']) {
    for (const denied of [false, true]) {
      await check(`delayed picture ${action} with unsupported custom clipboard (write denied: ${denied})`, async () => {
        const { page, errors } = await open(context, 'deck=generated/pictures.pptx')
        await page.locator('.pp-canvas-slide image[href^="blob:"]').first().waitFor({ state: 'attached' })
        const picture = slideShapes(page).filter({ has: page.locator('image') }).first()
        await picture.click()
        await page.evaluate((key) => {
          const controller = window.harness.controllers.a
          const slide = controller.state.slide
          const title = controller.slide(slide).shapes.find((shape) => shape.text)
          window.harness.commands.setShapeText(window.harness.docA, slide, title.key, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Picture clipboard regression' }] }] })
          controller.selectShapes([key, title.key])
        }, await picture.getAttribute('data-key'))
        const original = await slideShapes(page).count()
        await page.evaluate(async (denied) => {
          await navigator.clipboard.writeText('previous clipboard')
          Object.defineProperty(navigator.clipboard, 'write', { value: async () => {
            window.clipboardWriteAttempted = true
            throw new DOMException('Custom formats unsupported', 'NotSupportedError')
          } })
          if (denied) Object.defineProperty(navigator.clipboard, 'writeText', { value: async () => {
            throw new DOMException('Write denied', 'NotAllowedError')
          } })
          const assets = window.harness.assets
          const get = assets.get.bind(assets)
          assets.get = async (hash) => {
            window.copyAssetRequested = true
            await new Promise((resolve) => { window.releaseCopyAsset = resolve })
            return get(hash)
          }
        }, denied)
        await page.locator('.pp-canvas').focus()
        await page.keyboard.press(action === 'copy' ? 'Meta+c' : 'Meta+x')
        await page.waitForFunction(() => window.copyAssetRequested)
        // The native copy/cut event has returned before the asset becomes available.
        await page.evaluate(() => window.releaseCopyAsset())
        await page.waitForFunction(() => window.clipboardWriteAttempted)
        if (denied) {
          assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'previous clipboard')
          assert.equal(await slideShapes(page).count(), original, 'a failed cut keeps the picture')
        } else {
          await page.waitForFunction(async () => await navigator.clipboard.readText() === 'Picture clipboard regression', undefined, { timeout: 5000 })
          if (action === 'cut') await page.waitForFunction((count) => document.querySelectorAll('.pp-canvas-slide .pp-slide > [data-key]').length === count, original - 2)
          await page.keyboard.press('Meta+v')
          await page.waitForFunction((count) => document.querySelectorAll('.pp-canvas-slide .pp-slide > [data-key]').length === count, action === 'copy' ? original + 2 : original)
        }
        assert.deepEqual(errors, [])
        await page.close()
      })
    }
  }

  await check('presents with keyboard navigation, skips hidden slides, and shows presenter view', async () => {
    const { page, errors } = await open(context, 'deck=generated/layouts-notes-sections.pptx')
    await page.getByRole('button', { name: 'Present options' }).click()
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
    await page.getByRole('button', { name: 'Present options' }).click()
    await page.getByRole('menuitem', { name: 'Presenter view' }).click()
    await page.locator('.pp-presenter-notes').waitFor()
    assert.ok((await page.locator('.pp-presenter-notes').innerText()).length > 0)
    await page.keyboard.press('Escape')
    assert.deepEqual(errors, [])
    await page.close()
  })

  for (const mode of ['canvas', 'show', 'presenter']) {
    await check(`plays unloaded video on the first click in ${mode}`, async () => {
      const { page, errors, root, button } = await openVideo(context, mode)
      const geometry = await delayVideo(button)
      assert.ok(geometry.width > 0 && geometry.height > 0)
      await button.click()
      await page.waitForFunction(() => window.mediaRequested)
      await page.evaluate(() => window.releaseMedia())
      const video = page.locator(`${root} video.pp-media-player`)
      await video.waitFor({ state: 'attached' })
      assert.equal(await page.evaluate(() => window.mediaShape.isConnected), false, 'loading redraws the original shape')
      assert.deepEqual(await video.evaluate((video) => ({ left: video.offsetLeft, top: video.offsetTop, width: video.offsetWidth, height: video.offsetHeight })), geometry)
      await page.waitForFunction((selector) => document.querySelector(`${selector} video.pp-media-player`)?.currentTime > 0, root)
      assert.deepEqual(errors, [])
      await page.close()
    })

    for (const action of ['advance', 'close']) {
      await check(`cancels unloaded video when leaving ${mode} (${action})`, async () => {
        const { page, errors, button } = await openVideo(context, mode, true)
        await delayVideo(button)
        await button.click()
        await page.waitForFunction(() => window.mediaRequested)
        if (mode === 'canvas') {
          await page.evaluate((action) => {
            const controller = window.harness.controllers.a
            if (action === 'advance') controller.goToSlide(controller.slideKeys()[1])
            else window.harness.commands.deleteSlides(window.harness.docA, controller.slideKeys())
          }, action)
        } else await page.keyboard.press(action === 'advance' ? 'ArrowRight' : 'Escape')
        await page.evaluate(async () => { window.releaseMedia(); await window.mediaLoadFinished })
        assert.equal(await page.locator('.pp-media-player').count(), 0, 'no player appears after leaving the original slide')
        assert.deepEqual(errors, [])
        await page.close()
      })
    }
  }

  await check('resizes the table grid with canvas handles and undoes the frame and grid together', async () => {
    const { page, errors } = await open(context, 'blank=1')
    const key = await page.evaluate(() => {
      const controller = window.harness.controllers.a
      const table = window.harness.commands.tableShape(2, 3, { x: 1_000_000, y: 1_000_000, cx: 3_000_000, cy: 1_600_000 }, 'Resize table')
      window.harness.commands.insertShapes(window.harness.docA, controller.state.slide, [table])
      controller.selectShapes([table.key])
      return table.key
    })
    const before = await xfrmOf(page, key)
    const handle = page.locator('.pp-handle-se')
    const box = await handle.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 90, box.y + 60, { steps: 8 })
    await page.mouse.up()
    const resized = await page.evaluate((key) => {
      const controller = window.harness.controllers.a
      const shape = controller.shape(controller.state.slide, key)
      return { xfrm: shape.xfrm, width: shape.table.columns.reduce((sum, column) => sum + column.w, 0), height: shape.table.rows.reduce((sum, row) => sum + row.h, 0) }
    }, key)
    assert.ok(resized.xfrm.cx > before.cx && resized.xfrm.cy > before.cy)
    assert.equal(resized.width, resized.xfrm.cx)
    assert.equal(resized.height, resized.xfrm.cy)
    const frame = page.locator(`.pp-canvas-slide [data-key="${key}"]`)
    const visible = await frame.locator('table').boundingBox()
    const outer = await frame.boundingBox()
    assert.ok(Math.abs(visible.width - outer.width) < 1 && Math.abs(visible.height - outer.height) < 1)
    await page.keyboard.press('Meta+z')
    assert.deepEqual(await xfrmOf(page, key), before)
    await page.keyboard.press('Meta+Shift+z')
    assert.deepEqual(await xfrmOf(page, key), resized.xfrm)
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('read-only transitions block undo and redo keyboard shortcuts without losing history', async () => {
    const { page, errors } = await open(context, 'blank=1')
    await page.evaluate(() => { window.harness.controllers.a.insertShape('rect'); window.harness.controllers.a.setReadOnly(true) })
    const snapshot = () => page.evaluate(() => JSON.stringify(window.harness.controllers.a.slide(window.harness.controllers.a.state.slide)))
    const edited = await snapshot()
    await page.locator('.pp-canvas').focus()
    for (const key of ['Meta+z', 'Control+z', 'Meta+Shift+z', 'Control+y']) await page.keyboard.press(key)
    assert.equal(await snapshot(), edited)
    await page.evaluate(() => { const controller = window.harness.controllers.a; controller.setReadOnly(false); controller.undo(); controller.setReadOnly(true) })
    const undone = await snapshot()
    for (const key of ['Meta+Shift+z', 'Control+Shift+z', 'Meta+y', 'Control+y']) await page.keyboard.press(key)
    assert.equal(await snapshot(), undone)
    await page.evaluate(() => { window.harness.controllers.a.setReadOnly(false); window.harness.controllers.a.redo() })
    assert.equal(await snapshot(), edited)
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('stops an active drag when access becomes read-only', async () => {
    const { page, errors } = await open(context, 'deck=generated/autoshapes.pptx')
    const shape = slideShapes(page).nth(1)
    const key = await shape.getAttribute('data-key')
    const box = await shape.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 20)
    const moved = await xfrmOf(page, key)
    await page.evaluate(() => window.harness.controllers.a.setReadOnly(true))
    await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 100)
    await page.mouse.up()
    assert.deepEqual(await xfrmOf(page, key), moved)
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

  await check('prints pictures on unviewed slides after loading and decoding their assets', async () => {
    const { page, errors } = await open(context, 'deck=generated/pictures.pptx')
    const expected = await page.evaluate(() => {
      const { harness } = window
      let release
      const pending = new Promise((resolve) => { release = resolve })
      window.releasePrintAssets = release
      // No views subscribe to this controller, so none of its slide assets are cached.
      const cold = new harness.controllers.a.constructor({ doc: harness.docA, assets: { ...harness.assets, get: async (hash) => { await pending; return harness.assets.get(hash) } }, readOnly: true, user: { name: 'Print', color: '#123456' } })
      const observer = new MutationObserver(() => {
        const frame = document.querySelector('iframe')
        if (!frame) return
        frame.contentWindow.focus = () => {}
        frame.contentWindow.print = () => {
          window.printedPictures = [...frame.contentDocument.querySelectorAll('image')].map((image) => image.getAttribute('href'))
          window.printedPages = frame.contentDocument.querySelectorAll('.pp-print-page').length
          frame.contentWindow.dispatchEvent(new Event('afterprint'))
        }
      })
      observer.observe(document.body, { childList: true })
      window.printFinished = harness.printSlides(cold).finally(() => { observer.disconnect(); cold.destroy() })
      return { slides: cold.slideKeys().length, pictures: cold.slideKeys().flatMap((key) => cold.slide(key).shapes).filter((shape) => shape.kind === 'pic').length }
    })
    assert.equal(await page.locator('iframe').count(), 0, 'does not build print pages with unloaded assets')
    await page.evaluate(async () => { window.releasePrintAssets(); await window.printFinished })
    const result = await page.evaluate(() => ({ slides: window.printedPages, pictures: window.printedPictures }))
    assert.equal(result.slides, expected.slides)
    assert.ok(result.pictures.length >= expected.pictures, 'includes the slides’ pictures and inherited artwork')
    assert.ok(result.pictures.every((url) => url?.startsWith('blob:') || url?.startsWith('data:')))
    assert.equal(await page.locator('iframe').count(), 0, 'print frame cleaned up')
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('shows a print preparation error and lets the user retry', async () => {
    const { page, errors } = await open(context, 'deck=generated/pictures.pptx')
    await page.evaluate(() => { window.harness.controllers.a.loadAssetUrl = async () => undefined })
    await page.getByRole('button', { name: 'Export to PDF', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Unable to prepare the presentation for printing' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Export to PDF', exact: true }).isEnabled(), true)
    assert.equal(await page.locator('iframe').count(), 0)
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('shows a generic review entry for preserved notes formatting', async () => {
    const { page, errors } = await open(context, 'deck=generated/layouts-notes-sections.pptx')
    await page.evaluate(() => {
      const controller = window.harness.controllers.a
      const notes = window.harness.commands.slideMap(window.harness.docA, controller.state.slide).get('notes')
      notes.set('xml', notes.get('xml').replace('<p:notes ', '<p:notes showMasterSp="0" '))
    })
    await page.getByRole('button', { name: 'Changes', exact: true }).click()
    await page.getByText('Slide formatting changed', { exact: true }).waitFor()
    assert.ok(await page.locator('[data-presentation-diff] [data-status="edited"]').count() > 0)
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

  await check('table rows and columns: Tab in the last cell adds a row; inserts keep the editor on its cell', async () => {
    const { page, errors } = await open(context, 'blank=1')
    const key = await page.evaluate(() => window.harness.controllers.a.insertTable(2, 2))
    const table = page.locator(`.pp-canvas-slide [data-key="${key}"]`)
    const rows = () => page.evaluate((shape) => window.harness.controllers.a.shape(window.harness.controllers.a.state.slide, shape).table.rows.length, key)
    const cellAt = () => page.evaluate(() => window.harness.controllers.a.tableSelection()?.cell)
    let box = await table.locator('td[data-row="1"][data-col="1"]').boundingBox()
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
    await page.locator('.pp-canvas .pp-text-editor').waitFor()
    await page.keyboard.type('last')
    await page.keyboard.press('Tab')
    assert.equal(await rows(), 3)
    assert.deepEqual(await cellAt().then((cell) => [cell.rowIndex, cell.columnIndex]), [2, 0], 'the caret moves into the new row')
    await page.keyboard.type('new')
    assert.match(await page.evaluate(() => window.harness.text('a')), /new/)
    // A row inserted above the edited cell moves the cell, and the editor goes with it.
    await page.evaluate(() => window.harness.controllers.a.insertTableRow('above'))
    assert.deepEqual(await cellAt().then((cell) => [cell.rowIndex, cell.columnIndex]), [3, 0])
    box = await table.locator('td[data-row="3"][data-col="0"]').boundingBox()
    const frame = await page.locator('.pp-editor-frame').boundingBox()
    assert.ok(Math.abs(frame.y - box.y) < 2 && Math.abs(frame.x - box.x) < 2, `editor over its cell: ${JSON.stringify([frame, box])}`)
    await page.keyboard.press('Meta+z')
    assert.equal(await rows(), 3, 'one undo takes back the inserted row')
    await page.keyboard.press('Escape')
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('keyboard shortcuts: formatting selected shapes, new and duplicate slides, page keys, zoom, and host requests', async () => {
    const { page, errors } = await open(context, 'deck=generated/text-formatting.pptx')
    await page.evaluate(() => {
      window.requests = []
      window.harness.controllers.a.onRequest((request) => window.requests.push(request))
    })
    await page.locator('.pp-thumbs .pp-thumb').nth(2).click()
    const box = slideShapes(page).nth(1)
    const key = await box.getAttribute('data-key')
    await box.click()
    const text = () => page.evaluate((shape) => window.harness.controllers.a.shape(window.harness.controllers.a.state.slide, shape).text, key)
    const runs = (json) => json.content.flatMap((paragraph) => paragraph.content ?? []).filter((node) => node.type === 'text')
    await page.keyboard.press('Meta+b')
    assert.ok(runs(await text()).every((run) => run.marks.some((mark) => mark.type === 'b' && mark.attrs.value === true)), 'all runs bold')
    await page.keyboard.press('Meta+Shift+e')
    assert.ok((await text()).content.every((paragraph) => /algn="ctr"/.test(paragraph.attrs.pPr ?? '')), 'every paragraph centered')
    const before = await page.evaluate(() => window.harness.controllers.a.formatState().fontSize)
    await page.keyboard.press('Meta+Shift+Period')
    assert.ok(await page.evaluate(() => window.harness.controllers.a.formatState().fontSize) > before, 'bigger')
    assert.equal(await state(page).then((value) => value.editing), undefined, 'formatting does not open the text')
    // Ctrl+M adds a slide after the current one; Cmd+D with nothing selected duplicates it.
    const count = () => page.evaluate(() => window.harness.controllers.a.slideKeys().length)
    const slides = await count()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+m')
    assert.equal(await count(), slides + 1)
    await page.keyboard.press('Meta+d')
    assert.equal(await count(), slides + 2)
    const index = () => page.evaluate(() => window.harness.controllers.a.slideKeys().indexOf(window.harness.controllers.a.state.slide))
    const at = await index()
    await page.keyboard.press('PageUp')
    assert.equal(await index(), at - 1)
    await page.keyboard.press('PageDown')
    assert.equal(await index(), at)
    // Zoom by keys; Mod+Alt+0 fits again.
    const width = async () => (await page.locator('.pp-canvas-stage').boundingBox()).width
    const fitted = await width()
    await page.keyboard.press('Meta+Alt+Equal')
    assert.ok(await width() > fitted)
    await page.keyboard.press('Meta+Alt+Digit0')
    assert.ok(Math.abs(await width() - fitted) < 1)
    // Requests go to the host: find on the canvas, link in text being edited. The editor opens its
    // find bar and link dialog for them; Escape closes each and hands the keys back.
    await page.keyboard.press('Meta+f')
    await page.getByRole('searchbox', { name: 'Find in presentation' }).or(page.getByRole('textbox', { name: 'Find in presentation' })).waitFor()
    await page.keyboard.press('Escape')
    await page.locator('[data-presentation-find]').waitFor({ state: 'detached' })
    await page.keyboard.press('Control+h')
    await page.getByRole('textbox', { name: 'Replace with' }).waitFor()
    await page.keyboard.press('Escape')
    await page.locator('[data-presentation-find]').waitFor({ state: 'detached' })
    await page.locator('.pp-thumbs .pp-thumb').nth(2).click()
    await slideShapes(page).nth(1).dblclick()
    await page.locator('.pp-canvas .pp-text-editor').waitFor()
    await page.keyboard.press('Meta+k')
    await page.getByRole('dialog', { name: 'Insert link' }).or(page.getByRole('dialog', { name: 'Edit link' })).waitFor()
    await page.keyboard.press('Escape')
    await page.locator('[data-link-dialog]').waitFor({ state: 'detached' })
    await page.waitForFunction(() => document.activeElement?.closest('.pp-text-editor'))
    await page.keyboard.press('Meta+Shift+l')
    assert.deepEqual(await page.evaluate(() => window.requests), ['find', 'replace', 'link'])
    assert.equal(await page.evaluate(() => window.harness.controllers.a.formatState().align), 'l', 'Mod+Shift+L aligns left while editing')
    await page.keyboard.press('Escape')
    // Cmd+Enter presents from the current slide, Cmd+Shift+Enter from the beginning (Google Slides, PowerPoint for Mac).
    const current = await page.evaluate(() => window.harness.controllers.a.state.slide)
    await page.keyboard.press('Meta+Enter')
    await page.locator('.pp-present .pp-present-stage').waitFor()
    assert.equal(await page.locator('.pp-present .pp-present-stage').getAttribute('data-slide'), current)
    await page.keyboard.press('Escape')
    await page.locator('.pp-present').waitFor({ state: 'detached' })
    // Presenting with a shape selected does not open its text behind the show.
    assert.equal((await state(page)).editing, undefined)
    assert.equal(await page.evaluate(() => document.activeElement?.className), 'pp-canvas')
    await page.keyboard.press('Meta+Shift+Enter')
    await page.locator('.pp-present .pp-present-stage').waitFor()
    assert.equal(await page.locator('.pp-present .pp-present-stage').getAttribute('data-slide'), await page.evaluate(() => window.harness.controllers.a.slideKeys()[0]))
    await page.keyboard.press('Escape')
    await page.locator('.pp-present').waitFor({ state: 'detached' })
    // In the strip, Cmd+A selects every slide.
    await page.locator('.pp-thumbs').focus()
    await page.keyboard.press('Meta+a')
    assert.equal((await state(page)).slides.length, await count())
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('find shows matches on slides and in notes without taking focus; replace all reaches the collaborator', async () => {
    const { page, errors } = await open(context, 'deck=generated/text-formatting.pptx&split=1')
    await page.waitForFunction(() => window.harness.controllers.b)
    // The find bar's input keeps focus while matches are shown.
    await page.evaluate(() => {
      const field = document.createElement('input')
      field.id = 'find-field'
      document.body.prepend(field)
      field.focus()
    })
    const matches = await page.evaluate(() => window.harness.controllers.a.find('formatting').map((match) => ({ ...match })))
    assert.ok(matches.length >= 2, `${matches.length} matches`)
    await page.evaluate((match) => window.harness.controllers.a.revealMatch(match), matches[1])
    await page.locator('.pp-canvas .pp-find-match').first().waitFor()
    assert.equal(await page.locator('.pp-canvas .pp-find-match').first().innerText(), 'formatting')
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'find-field')
    assert.equal(await page.evaluate(() => window.harness.controllers.a.state.slide), matches[1].slide)
    const notes = await page.evaluate(() => window.harness.controllers.a.find('notes').find((match) => match.notes))
    await page.evaluate((match) => window.harness.controllers.a.revealMatch(match), notes)
    await page.locator('[data-testid="presentation-notes"] .pp-find-match').first().waitFor()
    assert.equal(await page.locator('[data-testid="presentation-notes"] .pp-find-match').first().innerText(), 'notes')
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'find-field')
    const count = await page.evaluate(() => window.harness.controllers.a.replaceAll('formatting', 'styling'))
    assert.equal(count, matches.length)
    await page.waitForFunction(() => window.harness.text('b').includes('Character styling'))
    await page.evaluate(() => window.harness.controllers.a.undo())
    await page.waitForFunction(() => window.harness.text('b').includes('Character formatting'))
    // Focus coming back to the slide (the find bar closed) goes on in the shown match's text:
    // typing replaces the match, not the whole text of the shape.
    const shown = matches.find((match) => match.shape && match.root === match.shape && !match.row)
    await page.evaluate((match) => window.harness.controllers.a.revealMatch(match), shown)
    await page.locator('.pp-canvas .pp-find-match').first().waitFor()
    const shapeText = () => page.evaluate((match) => {
      const controller = window.harness.controllers.a
      const flat = (node) => (node?.text ?? '') + (node?.content ?? []).map(flat).join('')
      return controller.shape(match.slide, match.shape).text.content.map(flat)
    }, shown)
    const original = await shapeText()
    await page.locator('.pp-canvas').first().focus()
    await page.keyboard.type('styling')
    const typed = await shapeText()
    assert.equal(typed[shown.paragraph], original[shown.paragraph].slice(0, shown.from) + 'styling' + original[shown.paragraph].slice(shown.to))
    assert.equal(typed.length, original.length)
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('speaker notes take formatting from shortcuts and the toolbar while they have focus', async () => {
    const { page, errors } = await open(context, 'deck=generated/text-formatting.pptx')
    const shape = slideShapes(page).first()
    const key = await shape.getAttribute('data-key')
    await shape.click()
    const titleRuns = () => page.evaluate((key) => JSON.stringify(window.harness.controllers.a.shape(window.harness.controllers.a.state.slide, key).text), key)
    const title = await titleRuns()
    const notes = page.locator('[data-testid="presentation-notes"] .pp-text-editor')
    await notes.click()
    // The editor reads where the click put the caret on the next selectionchange: wait for it,
    // or Enter splits the paragraph the editor still thinks the caret is in.
    await page.waitForFunction(() => window.harness.controllers.a.notesTarget?.view.state.selection.from > 1)
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.press('Enter')
    await page.keyboard.type('Bold words')
    await page.keyboard.press('Meta+Shift+ArrowLeft')
    // The editor reads the selection asynchronously; wait until it has, as a person would.
    await page.waitForFunction(() => window.harness.controllers.a.notesTarget?.view.state.selection.empty === false)
    await page.keyboard.press('Meta+b')
    await page.getByRole('button', { name: 'Italic' }).first().click()
    const notesRun = await page.evaluate(() => {
      const controller = window.harness.controllers.a
      const paragraphs = controller.slide(controller.state.slide).notes.text.content
      return paragraphs[paragraphs.length - 1].content[0]
    })
    assert.equal(notesRun.text, 'Bold words')
    assert.ok(notesRun.marks.some((mark) => mark.type === 'b') && notesRun.marks.some((mark) => mark.type === 'i'), JSON.stringify(notesRun))
    assert.equal(await titleRuns(), title, 'the selected shape is untouched')
    assert.equal(await page.evaluate(() => document.activeElement?.closest('[data-testid="presentation-notes"]') !== null), true, 'focus stays in the notes')
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

  await check('menu bar: view toggles, undo, presenting, printing, and the shortcuts list', async () => {
    const { page, errors } = await open(context, 'deck=generated/layouts-notes-sections.pptx')
    const bar = page.getByRole('menubar', { name: 'Menu bar' })
    const view = async (name) => {
      await bar.getByRole('menuitem', { name: 'View' }).click()
      await page.getByRole('menuitemcheckbox', { name }).click()
    }
    await view('Slide sorter')
    await page.getByTestId('presentation-sorter').waitFor()
    await view('Slide sorter')
    await page.getByTestId('presentation-sorter').waitFor({ state: 'detached' })
    await view('Speaker notes')
    await page.waitForFunction(() => document.querySelector('[data-testid="presentation-notes"]').classList.contains('hidden'))
    await view('Format panel')
    await page.getByRole('complementary', { name: 'Format panel' }).waitFor()

    // Edit ▸ Undo takes back a slide added from the strip.
    const slides = await page.evaluate(() => window.harness.controllers.a.slideKeys().length)
    await page.evaluate(() => window.harness.controllers.a.duplicateSlides())
    await page.waitForFunction((count) => window.harness.controllers.a.slideKeys().length === count + 1, slides)
    await bar.getByRole('menuitem', { name: 'Edit' }).click()
    await page.getByRole('menuitem', { name: 'Undo' }).click()
    await page.waitForFunction((count) => window.harness.controllers.a.slideKeys().length === count, slides)

    // View ▸ Present from the beginning starts the show; its keys stay the show's.
    await bar.getByRole('menuitem', { name: 'View' }).click()
    await page.getByRole('menuitem', { name: 'Present from the beginning' }).click()
    await page.locator('.pp-present .pp-slide').waitFor()
    await page.keyboard.press('Escape')
    await page.locator('.pp-present').waitFor({ state: 'detached' })

    // File ▸ Print and Cmd/Ctrl+P print the slides, not the page.
    await page.evaluate(() => {
      window.printed = 0
      window.print = () => { window.pagePrinted = true }
      new MutationObserver(() => {
        for (const frame of document.querySelectorAll('iframe')) {
          if (frame.dataset.stubbed) continue
          frame.dataset.stubbed = '1'
          frame.contentWindow.focus = () => {}
          frame.contentWindow.print = () => {
            if (frame.contentDocument.querySelector('.pp-print-page')) window.printed++
            frame.contentWindow.dispatchEvent(new Event('afterprint'))
          }
        }
      }).observe(document.body, { childList: true })
    })
    await bar.getByRole('menuitem', { name: 'File' }).click()
    await page.getByRole('menuitem', { name: 'Print' }).click()
    await page.waitForFunction(() => window.printed === 1, null, { timeout: 15_000 })
    await page.locator('[data-testid="presentation-canvas"]').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+p`)
    await page.waitForFunction(() => window.printed === 2, null, { timeout: 15_000 })
    assert.equal(await page.evaluate(() => window.pagePrinted ?? false), false)

    await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+/`)
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await dialog.getByRole('searchbox', { name: 'Search shortcuts' }).fill('present')
    await dialog.getByText('Present from the current slide').waitFor()
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
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

  const contextMenu = (page) => page.locator('[data-presentation-context-menu]')
  // Menus hand focus back once they have closed (Radix restores focus a task later).
  const focusIn = (page, selector) => page.waitForFunction((selector) => document.activeElement?.closest(selector), selector, { timeout: 2000 })

  await check('right-click menus: a shape duplicates and rotates, a table cell adds a row, the empty slide adds a slide; text keeps the browser menu', async () => {
    const { page, errors } = await open(context, 'deck=generated/text-formatting.pptx')
    const shapes = () => page.evaluate(() => window.harness.controllers.a.slide(window.harness.controllers.a.state.slide).shapes.map((shape) => shape.key))
    const before = await shapes()
    await slideShapes(page).nth(1).click({ button: 'right' })
    await contextMenu(page).waitFor()
    assert.deepEqual((await state(page)).shapes, [before[1]], 'the right-clicked shape is selected')
    await contextMenu(page).getByRole('menuitem', { name: 'Duplicate' }).click()
    await contextMenu(page).waitFor({ state: 'detached' })
    assert.equal((await shapes()).length, before.length + 1)
    await focusIn(page, '.pp-canvas')
    // Rotate ▸ Rotate clockwise 90° on the copy (now selected), then undo by key: focus is on the slide.
    const copy = (await state(page)).shapes[0]
    const copyShape = page.locator(`.pp-canvas-slide .pp-slide > [data-key="${copy}"]`)
    await copyShape.click({ button: 'right' })
    await contextMenu(page).getByRole('menuitem', { name: 'Rotate', exact: true }).hover()
    await page.getByRole('menuitem', { name: 'Rotate clockwise 90°' }).click()
    await contextMenu(page).waitFor({ state: 'detached' })
    assert.equal((await xfrmOf(page, copy)).rot, 5_400_000)
    await focusIn(page, '.pp-canvas')
    await page.keyboard.press('Meta+z')
    assert.equal((await xfrmOf(page, copy)).rot ?? 0, 0, 'undo takes back the rotation')
    // Escape closes a menu and hands the keys back to the slide.
    await copyShape.click({ button: 'right' })
    await contextMenu(page).waitFor()
    await page.keyboard.press('Escape')
    await contextMenu(page).waitFor({ state: 'detached' })
    await focusIn(page, '.pp-canvas')
    // Inside text being edited the browser's own menu (spelling, cut, copy, paste) shows.
    await slideShapes(page).first().dblclick()
    await page.locator('.pp-canvas .pp-text-editor').waitFor()
    await page.locator('.pp-canvas .pp-text-editor').click({ button: 'right' })
    await page.waitForTimeout(150)
    assert.equal(await contextMenu(page).count(), 0)
    await page.keyboard.press('Escape')
    // The slide beside the shapes: New slide.
    const slides = await page.evaluate(() => window.harness.controllers.a.slideKeys().length)
    await page.locator('[data-testid="presentation-canvas"]').click({ button: 'right', position: { x: 5, y: 5 } })
    await contextMenu(page).getByRole('menuitem', { name: 'New slide' }).click()
    assert.equal(await page.evaluate(() => window.harness.controllers.a.slideKeys().length), slides + 1)
    assert.deepEqual((await state(page)).shapes, [])
    // A table cell: Insert row above the cell right-clicked.
    await page.evaluate(() => window.harness.controllers.a.insertTable(2, 3))
    await page.locator('.pp-canvas-slide td').first().waitFor()
    const table = (await state(page)).shapes[0]
    const rows = () => page.evaluate((key) => window.harness.controllers.a.shape(window.harness.controllers.a.state.slide, key).table.rows.map((row) => row.key), table)
    const rowsBefore = await rows()
    await page.locator('.pp-canvas-slide td').nth(4).click({ button: 'right' })
    await contextMenu(page).getByRole('menuitem', { name: 'Insert row above' }).click()
    const rowsAfter = await rows()
    assert.equal(rowsAfter.length, 3)
    assert.equal(rowsAfter[2], rowsBefore[1], 'the new row went above the second row')
    assert.equal(rowsAfter[0], rowsBefore[0])
    // Delete row works on that cell; Delete table removes it.
    await page.locator('.pp-canvas-slide td').nth(4).click({ button: 'right' })
    await contextMenu(page).getByRole('menuitem', { name: 'Delete row' }).click()
    assert.equal((await rows()).length, 2)
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('right-click on thumbnails: hide, duplicate, move, and sections added, renamed, and removed', async () => {
    const { page, errors } = await open(context, 'deck=generated/layouts-notes-sections.pptx')
    const keys = () => page.evaluate(() => window.harness.controllers.a.slideKeys())
    const original = await keys()
    const thumb = (index) => page.locator('.pp-thumbs .pp-thumb').nth(index)
    await thumb(1).click({ button: 'right' })
    await contextMenu(page).getByRole('menuitemcheckbox', { name: 'Hide slide' }).click()
    assert.equal(await page.evaluate((key) => window.harness.controllers.a.slide(key).hidden, original[1]), true)
    await page.locator(`.pp-thumbs .pp-thumb-hidden[data-slide="${original[1]}"]`).waitFor()
    await focusIn(page, '.pp-thumbs')
    await thumb(1).click({ button: 'right' })
    await contextMenu(page).getByRole('menuitem', { name: 'Duplicate slide' }).click()
    assert.equal((await keys()).length, original.length + 1)
    // Move slide to end: the copy (selected) goes last.
    const duplicate = (await state(page)).slide
    await page.locator(`.pp-thumbs .pp-thumb[data-slide="${duplicate}"]`).click({ button: 'right' })
    await contextMenu(page).getByRole('menuitem', { name: 'Move slide to end' }).click()
    assert.equal((await keys()).at(-1), duplicate)
    // Add section… names a section starting at the slide right-clicked.
    await thumb(2).click({ button: 'right' })
    await contextMenu(page).getByRole('menuitem', { name: 'Add section…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Add section' })
    await dialog.getByLabel('Section name').fill('Appendix')
    await page.keyboard.press('Enter')
    await dialog.waitFor({ state: 'detached' })
    const sections = () => page.evaluate(() => window.harness.controllers.a.sections().map(({ name, firstSlide }) => ({ name, firstSlide })))
    assert.ok((await sections()).some((section) => section.name === 'Appendix' && section.firstSlide === original[2]), JSON.stringify(await sections()))
    await focusIn(page, '.pp-thumbs')
    // A section header's menu renames and removes it.
    const header = page.locator('.pp-thumbs .pp-section', { hasText: 'Appendix' })
    await header.click({ button: 'right' })
    await contextMenu(page).getByRole('menuitem', { name: 'Rename section…' }).click()
    const rename = page.getByRole('dialog', { name: 'Rename section' })
    assert.equal(await rename.getByLabel('Section name').inputValue(), 'Appendix')
    await rename.getByLabel('Section name').fill('Extras')
    await rename.getByRole('button', { name: 'Rename' }).click()
    await page.locator('.pp-thumbs .pp-section', { hasText: 'Extras' }).click({ button: 'right' })
    await contextMenu(page).getByRole('menuitem', { name: 'Remove section' }).click()
    assert.ok(!(await sections()).some((section) => section.name === 'Extras' || section.name === 'Appendix'))
    // The sorter has the same menu.
    await page.getByRole('button', { name: 'Slide sorter' }).click()
    await page.locator('.pp-sorter .pp-thumb').nth(0).click({ button: 'right' })
    await contextMenu(page).getByRole('menuitem', { name: 'Duplicate slide' }).click()
    assert.equal((await keys()).length, original.length + 2)
    await focusIn(page, '.pp-sorter')
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('find and replace across slides and notes; the link dialog; a typed font size; the font menu', async () => {
    const { page, errors } = await open(context, 'deck=generated/text-formatting.pptx&split=1')
    await page.waitForFunction(() => window.harness.controllers.b)
    const editor = page.locator('[data-presentation-editor]').first()
    await editor.locator('[data-testid="presentation-canvas"]').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Meta+f')
    const bar = editor.locator('[data-presentation-find]')
    const field = bar.getByRole('textbox', { name: 'Find in presentation' })
    await field.waitFor()
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Find in presentation')
    await page.keyboard.type('formatting')
    const total = await page.evaluate(() => window.harness.controllers.a.find('formatting').length)
    assert.ok(total >= 2)
    const status = bar.locator('[data-find-status]')
    await page.waitForFunction(([text]) => document.querySelector('[data-find-status]')?.textContent === text, [`1 of ${total}`])
    await page.keyboard.press('Enter')
    assert.equal(await status.textContent(), `2 of ${total}`)
    await page.keyboard.press('Shift+Enter')
    assert.equal(await status.textContent(), `1 of ${total}`)
    await editor.locator('.pp-canvas .pp-find-match').first().waitFor()
    // Replace all, from Cmd+Shift+H in the bar: one undo step, and the collaborator sees it.
    await page.keyboard.press('Meta+Shift+h')
    await bar.getByRole('textbox', { name: 'Replace with' }).fill('styling')
    await bar.getByRole('button', { name: 'Replace all' }).click()
    assert.equal(await status.textContent(), `Replaced ${total}`)
    await page.waitForFunction(() => !/formatting/i.test(window.harness.text('b')))
    // Notes too: the notes pane opens for a match in it.
    await field.fill('notes')
    const notesMatches = await page.evaluate(() => window.harness.controllers.a.find('notes').filter((match) => match.notes).length)
    assert.ok(notesMatches > 0)
    await bar.getByRole('textbox', { name: 'Replace with' }).fill('remarks')
    await bar.getByRole('button', { name: 'Replace all' }).click()
    await page.waitForFunction(() => window.harness.text('b').includes('Title slide remarks'))
    // No match is left, and focus is still in the bar: Escape closes it.
    assert.equal(await bar.getByRole('button', { name: 'Replace all' }).getAttribute('aria-disabled'), 'true')
    assert.ok(await page.evaluate(() => document.activeElement?.closest('[data-presentation-find]') !== null), 'focus stays in the find bar')
    await page.keyboard.press('Escape')
    await bar.waitFor({ state: 'detached' })
    assert.ok(await page.evaluate(() => document.activeElement?.closest('.pp-canvas, [data-testid="presentation-notes"]') !== null), 'focus goes back to the document')
    await page.keyboard.press('Escape')
    // Cmd/Ctrl+K on selected text: the link dialog applies a normalized link, then removes it.
    await page.locator('.pp-thumbs').first().locator('.pp-thumb').nth(1).click()
    await editor.locator('.pp-canvas-slide .pp-slide > [data-key]').first().dblclick()
    await editor.locator('.pp-canvas .pp-text-editor').waitFor()
    await page.keyboard.press('Meta+a')
    await page.keyboard.press('Meta+k')
    const insert = page.getByRole('dialog', { name: 'Insert link' })
    await insert.getByLabel('Link').fill('example.com')
    await page.keyboard.press('Enter')
    await insert.waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => window.harness.controllers.a.formatState().link), 'https://example.com')
    await page.waitForFunction(() => document.activeElement?.closest('.pp-text-editor'))
    await page.keyboard.press('Meta+k')
    const edit = page.getByRole('dialog', { name: 'Edit link' })
    assert.equal(await edit.getByLabel('Link').inputValue(), 'https://example.com')
    await edit.getByRole('button', { name: 'Remove link' }).click()
    assert.equal(await page.evaluate(() => window.harness.controllers.a.formatState().link), undefined)
    // A typed font size applies to the selection, and the text keeps the keys.
    await page.waitForFunction(() => document.activeElement?.closest('.pp-text-editor'))
    await page.keyboard.press('Meta+a')
    await editor.getByRole('textbox', { name: 'Font size' }).fill('30')
    await page.keyboard.press('Enter')
    assert.equal(await page.evaluate(() => window.harness.controllers.a.formatState().fontSize), 30)
    await page.waitForFunction(() => document.activeElement?.closest('.pp-text-editor'))
    // The font menu lists the theme's fonts first; Headings writes the theme font reference.
    await editor.getByRole('button', { name: 'Font', exact: true }).click()
    await page.getByRole('menuitemradio', { name: /\(Headings\)$/ }).click()
    assert.equal(await page.evaluate(() => window.harness.controllers.a.formatState().fontFamily), '+mj-lt')
    await page.waitForFunction(() => document.activeElement?.closest('.pp-text-editor'))
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('menu bar: Insert slide number while editing, Arrange center on page, Format text fitting; the status bar counts slides and fits the zoom', async () => {
    const { page, errors } = await open(context, 'deck=generated/text-formatting.pptx')
    const bar = page.getByRole('menubar', { name: 'Menu bar' })
    const menu = async (name, item, sub) => {
      await bar.getByRole('menuitem', { name, exact: true }).click()
      if (sub) await page.getByRole('menuitem', { name: sub, exact: true }).hover()
      await page.getByRole('menuitem', { name: item, exact: true }).or(page.getByRole('menuitemradio', { name: item, exact: true })).or(page.getByRole('menuitemcheckbox', { name: item, exact: true })).first().click()
    }
    const counter = page.locator('[data-slide-counter]')
    const slides = await page.evaluate(() => window.harness.controllers.a.slideKeys().length)
    assert.equal(await counter.textContent(), `Slide 1 of ${slides}`)
    await page.locator('.pp-thumbs .pp-thumb').nth(1).click()
    assert.equal(await counter.textContent(), `Slide 2 of ${slides}`)
    // Insert ▸ Slide number puts a field at the caret.
    const shape = slideShapes(page).first()
    const key = await shape.getAttribute('data-key')
    await shape.dblclick()
    await page.locator('.pp-canvas .pp-text-editor').waitFor()
    await page.keyboard.press('End')
    await menu('Insert', 'Slide number')
    const text = () => page.evaluate((key) => JSON.stringify(window.harness.controllers.a.shape(window.harness.controllers.a.state.slide, key).text), key)
    assert.match(await text(), /"fieldType":"slidenum"/)
    await page.waitForFunction(() => document.activeElement?.closest('.pp-text-editor'), null, { timeout: 2000 })
    await page.keyboard.press('Escape')
    // Arrange ▸ Center on page ▸ Horizontally.
    await menu('Arrange', 'Horizontally', 'Center on page')
    const size = await page.evaluate(() => window.harness.controllers.a.size())
    const xfrm = await xfrmOf(page, key)
    assert.ok(Math.abs(xfrm.x - (size.width * 9525 - xfrm.cx) / 2) < 2, JSON.stringify(xfrm))
    await focusIn(page, '.pp-canvas')
    // Several shapes move as one, keeping their spacing, as in Google Slides (not each to the center).
    const box = await page.evaluate(() => window.harness.controllers.a.insertTextBox({ x: 100_000, y: 100_000, cx: 1_000_000, cy: 400_000 }))
    const pair = [key, box]
    await page.evaluate((pair) => window.harness.controllers.a.selectShapes(pair), pair)
    const xs = () => Promise.all(pair.map(async (shape) => (await xfrmOf(page, shape)).x))
    const apart = await xs()
    await menu('Arrange', 'Horizontally', 'Center on page')
    const together = await xs()
    assert.equal(together[1] - together[0], apart[1] - apart[0], 'the shapes keep their places relative to each other')
    assert.notDeepEqual(together, apart)
    await focusIn(page, '.pp-canvas')
    await page.keyboard.press('Meta+z')
    assert.deepEqual(await xs(), apart, 'one undo step')
    await page.evaluate((key) => window.harness.controllers.a.selectShapes([key]), key)
    // Format ▸ Text fitting ▸ Resize shape to fit text.
    await menu('Format', 'Resize shape to fit text', 'Text fitting')
    assert.equal(await page.evaluate(() => window.harness.controllers.a.formatState().textBox?.autofit), 'shape')
    // Slide ▸ Move slide ▸ Move slide to beginning.
    const current = (await state(page)).slide
    await menu('Slide', 'Move slide to beginning', 'Move slide')
    assert.equal(await page.evaluate(() => window.harness.controllers.a.slideKeys()[0]), current)
    assert.equal(await counter.textContent(), `Slide 1 of ${slides}`)
    // The status bar: zoom in, then back to Fit; the notes toggle.
    const zoom = page.locator('[data-presentation-zoom]')
    assert.equal(await zoom.textContent(), 'Fit')
    const status = page.locator('[data-presentation-status]')
    await status.getByRole('button', { name: 'Zoom in' }).click()
    assert.match(await zoom.textContent(), /^\d+%$/)
    await status.getByRole('button', { name: 'Zoom', exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'Fit' }).click()
    assert.equal(await zoom.textContent(), 'Fit')
    await status.getByRole('button', { name: 'Notes' }).click()
    await page.waitForFunction(() => document.querySelector('[data-testid="presentation-notes"]').classList.contains('hidden'))
    // View ▸ Zoom ▸ 200% and Show filmstrip.
    await menu('View', '200%', 'Zoom')
    assert.equal(await zoom.textContent(), '200%')
    await menu('View', 'Show filmstrip')
    await page.locator('nav[aria-label="Slides"]').waitFor({ state: 'hidden' })
    assert.deepEqual(errors, [])
    await page.close()
  })

  await check('the sorter offers no slide inserts and clears the shapes; find closes back to it; toolbar menus hand the keys back to the slide', async () => {
    const { page, errors } = await open(context, 'deck=generated/autoshapes.pptx')
    const bar = page.getByRole('menubar', { name: 'Menu bar' })
    // Present stays in sight at the toolbar's right while its editing tools scroll (a 1440px window).
    const toolbar = await page.getByRole('toolbar', { name: 'Presentation' }).boundingBox()
    const presentButton = await page.getByRole('button', { name: 'Present', exact: true }).boundingBox()
    assert.ok(presentButton.x + presentButton.width <= toolbar.x + toolbar.width + 0.5, `Present is in sight: ${JSON.stringify({ presentButton, toolbar })}`)
    const shape = slideShapes(page).nth(1)
    const key = await shape.getAttribute('data-key')
    await shape.click()
    // The sorter shows no shapes: the selection goes, so Format and Arrange cannot change unseen shapes.
    await page.getByRole('button', { name: 'Slide sorter' }).click()
    await page.getByTestId('presentation-sorter').waitFor()
    assert.deepEqual((await state(page)).shapes, [])
    // Its thumbnails have the slide's shape (they used to collapse to no height in the grid).
    await page.waitForFunction(() => {
      const frames = [...document.querySelectorAll('.pp-sorter .pp-thumb-frame')]
      return frames.length > 0 && frames.every((frame) => frame.offsetHeight > 0.5 * frame.offsetWidth && frame.querySelector('.pp-slide'))
    }, null, { timeout: 5000 })
    await bar.getByRole('menuitem', { name: 'Insert', exact: true }).click()
    for (const id of ['text-box', 'image', 'insert-shape', 'insert-line', 'insert-table']) {
      assert.notEqual(await page.locator(`[role="menu"] [data-menu-item="${id}"]`).getAttribute('data-disabled'), null, `Insert ▸ ${id} is off in the sorter`)
    }
    await page.keyboard.press('Escape')
    for (const name of ['Text box', 'Shapes', 'Line', 'Image', 'Table']) assert.equal(await page.getByRole('button', { name, exact: true }).isDisabled(), true, `${name} is off in the sorter`)
    // Find with nothing found closes back to the sorter, not the hidden slide.
    await page.locator('.pp-sorter .pp-thumb').nth(0).click()
    await page.keyboard.press('Meta+f')
    await page.getByRole('textbox', { name: 'Find in presentation' }).fill('no such words anywhere')
    await page.keyboard.press('Escape')
    await page.locator('[data-presentation-find]').waitFor({ state: 'detached' })
    await focusIn(page, '.pp-sorter')
    await page.getByRole('button', { name: 'Slide sorter' }).click()
    await page.getByTestId('presentation-sorter').waitFor({ state: 'detached' })
    // Toolbar menus and pickers give the keys back to the slide: an arrow then nudges the new line.
    await page.getByRole('button', { name: 'Line', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Arrow', exact: true }).click()
    await focusIn(page, '.pp-canvas')
    const arrow = (await state(page)).shapes[0]
    const x = (await xfrmOf(page, arrow)).x
    await page.keyboard.press('ArrowRight')
    assert.equal((await xfrmOf(page, arrow)).x, x + 2 * 9525, 'the arrow key nudges the inserted line')
    await page.getByRole('button', { name: 'Shapes', exact: true }).click()
    await page.getByRole('button', { name: 'Oval', exact: true }).click()
    await focusIn(page, '.pp-canvas')
    await page.keyboard.press('Delete')
    assert.equal(await page.evaluate(() => window.harness.controllers.a.state.shapes.length), 0, 'Delete removes the inserted oval')
    await page.evaluate((key) => window.harness.controllers.a.selectShapes([key]), key)
    await page.getByRole('button', { name: 'Shape fill', exact: true }).click()
    await page.getByRole('button', { name: 'Red', exact: true }).click()
    await focusIn(page, '.pp-canvas')
    await page.getByRole('button', { name: 'New slide with layout' }).click()
    await page.getByRole('menuitem').nth(1).click()
    await focusIn(page, '.pp-canvas')
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
