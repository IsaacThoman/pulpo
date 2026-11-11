// Refreshes the script behind the landing page's animated demo (src/pages/landing/demo/script.json):
// plays each scene's message against a real Pulpo instance and records what came back and when.
// See docs/landing-screenshots.md.
//
//   PULPO_DEMO_EMAIL=… PULPO_DEMO_PASSWORD=… npm run capture:landing-demo -w @pulpo/web
//   npm run capture:landing-demo -w @pulpo/web -- --only agent
//
// Without the two variables a browser window opens for you to sign in. A scene's `id`, `model`, speeds, `scroll`,
// and `beats` are written by hand, as are `pacing` and `suggestions`; the script keeps them and replaces
// the rest. To change what a scene asks, edit its beats and run this again.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'

const scriptPath = new URL('../src/pages/landing/demo/script.json', import.meta.url).pathname
const publicDirectory = new URL('../public/', import.meta.url).pathname
const current = JSON.parse(readFileSync(scriptPath, 'utf8'))
const { values: args } = parseArgs({ options: { only: { type: 'string' }, 'keep-chats': { type: 'boolean', default: false } } })
const origin = process.env.PULPO_URL ?? 'https://pulpo.baby'
const { PULPO_DEMO_EMAIL: email, PULPO_DEMO_PASSWORD: password } = process.env
if (args.only && !current.scenes.some((scene) => scene.id === args.only)) throw new Error(`No scene called ${args.only}`)

const seconds = (ms) => `${Math.round(ms / 1000)}s`
const oneLine = (text) => text.replace(/\s+/g, ' ').trim()
const size = (bytes) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${Math.round(bytes / 1024)} KiB` : `${(bytes / 1024 ** 2).toFixed(1)} MiB`)

const browser = await chromium.launch({ headless: Boolean(email && password) })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const api = (method, path) => page.evaluate(async ({ method, path }) => {
    const response = await fetch(path, { method })
    return { ok: response.ok, status: response.status, json: await response.json().catch(() => null) }
  }, { method, path })

  await page.goto(`${origin}/login`)
  if (email && password) {
    await page.getByLabel('Email').fill(email)
    await page.locator('#password').fill(password)
    await page.locator('#password').press('Enter')
  } else {
    console.log(`Sign in to ${origin} in the browser window. Waiting up to 10 minutes…`)
  }
  const deadline = Date.now() + (email && password ? 30_000 : 10 * 60_000)
  while (!(await api('GET', '/api/me').catch(() => ({ ok: false }))).ok) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for sign-in')
    await page.waitForTimeout(1000)
  }

  // Socket frames carry each answer as it streams.
  const frames = []
  page.on('websocket', (socket) => socket.on('framereceived', (frame) => frames.push({ at: Date.now(), payload: String(frame.payload) })))
  const composer = page.getByPlaceholder(/Message/).first()
  const openNewChat = async () => {
    await page.goto(origin)
    await composer.waitFor()
    await page.waitForLoadState('networkidle').catch(() => {})
    // A send made before the catalog loads goes out without the composer's controls.
    await page.getByRole('button', { name: /Agent options/ }).first().waitFor()
    await page.waitForTimeout(1500)
  }
  const modelButton = page.getByRole('button', { name: /^Model: / }).first()
  const currentModelName = async () => (await modelButton.getAttribute('aria-label')).replace(/^Model: /, '')
  const selectModel = async (name) => {
    if (await currentModelName() === name) return
    await modelButton.click()
    // An option's accessible name also carries its favorite toggle, so match on its text.
    await page.getByRole('option').filter({ hasText: new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).first().click()
    await page.waitForTimeout(600)
    if (await currentModelName() !== name) throw new Error(`Could not select ${name}`)
  }
  const readControls = async () => {
    const [, reasoning = '', speed = ''] = (await page.getByRole('button', { name: /Generation options/ }).first().getAttribute('aria-label') ?? '').split(', ')
    const agent = (await page.getByRole('button', { name: /Agent options/ }).first().getAttribute('aria-label') ?? '').replace(/^Agent options, /, '')
    return { reasoning, speed, agent }
  }

  await openNewChat()
  const catalog = (await api('GET', '/api/models')).json.data
  const me = (await api('GET', '/api/me')).json.user
  const sidebar = ((await api('GET', '/api/chats')).json?.data ?? []).filter((item) => !item.temporary).slice(0, 14).map((item) => item.title)
  const originalModel = await currentModelName()
  // The picker opens on the account's favorites, which is what the phone's menu lists.
  await modelButton.click()
  const favorites = await page.getByRole('option').allTextContents()
  await page.keyboard.press('Escape')

  const controls = {}
  const describe = (id) => {
    const model = catalog.find((candidate) => candidate.id === id)
    if (!model) throw new Error(`The instance has no model ${id}`)
    // `icon` is a file in public/ai-icons; single-color marks are inverted on dark backgrounds.
    return { id: model.id, name: model.name, lab: model.lab?.name ?? model.provider.name, icon: `${model.logo ?? model.lab?.logo}.svg`, ...(controls[id] ? { controls: controls[id] } : {}) }
  }

  const scenes = []
  for (const scene of current.scenes) {
    if (args.only && scene.id !== args.only) {
      scenes.push(scene)
      continue
    }
    const answering = scene.beats.findLast((beat) => beat.type === 'pick')?.model ?? scene.model
    const prompt = scene.beats.filter((beat) => beat.type === 'type').map((beat) => beat.text).join('')
    await openNewChat()
    for (const id of new Set([scene.model, answering])) {
      await selectModel(describe(id).name)
      controls[id] = await readControls()
    }

    await composer.fill(prompt)
    const sentAt = Date.now()
    await composer.press('Enter')
    await page.waitForURL(/\/c\//, { timeout: 30_000 })
    const chatId = new URL(page.url()).pathname.split('/').pop()
    const stop = page.getByLabel('Stop generating')
    await stop.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {})
    await stop.waitFor({ state: 'hidden', timeout: 300_000 })

    // The generated title arrives a little after the answer.
    let chat
    for (let attempt = 0; attempt < 20; attempt++) {
      chat = (await api('GET', `/api/chats/${chatId}`)).json
      if (chat?.title && chat.title !== prompt) break
      await page.waitForTimeout(500)
    }
    const response = chat.responses.at(-1)
    if (response.status !== 'completed') throw new Error(`Scene ${scene.id} ended as ${response.status}`)
    const text = response.output.flatMap((item) => (item.type === 'message' ? item.content ?? [] : [])).filter((part) => part.type === 'output_text').map((part) => part.text).join('')

    const events = frames.flatMap(({ at, payload }) => {
      const start = payload.indexOf('[')
      if (start < 0 || !/^\d+$/.test(payload.slice(0, start))) return []
      try {
        const [name, body] = JSON.parse(payload.slice(start))
        return typeof name === 'string' ? [{ ms: at - sentAt, name, body }] : []
      } catch {
        return []
      }
    }).filter((event) => event.ms >= 0)
    const deltas = events
      .filter((event) => event.name === 'response.event' && event.body.responseId === response.id && event.body.type === 'response.output_text.delta')
      .map((event) => [event.ms, event.body.payload.delta])
    if (deltas.map(([, delta]) => delta).join('') !== text) throw new Error(`Scene ${scene.id}: the streamed text does not match the stored answer; the socket protocol may have changed`)
    const completedMs = events.find((event) => event.name === 'response.completed' && event.body.responseId === response.id)?.ms ?? deltas.at(-1)[0]
    const titleMs = events.findLast((event) => event.name === 'chat.changed' && event.body.chatId === chatId)?.ms ?? completedMs
    const followMs = events.find((event) => event.name === 'chat.started' && event.body.chatId === chatId)?.ms ?? 150

    // What the agent did in its workspace, in the order the chat lists it.
    const received = Date.parse(response.snapshot?.requestReceivedAt ?? response.createdAt)
    const steps = []
    let attachment
    for (const item of response.output) {
      const startedMs = item.startedAt ? Date.parse(item.startedAt) - received : undefined
      if (item.type === 'pulpo_workspace') {
        steps.push({ kind: 'workspace', atMs: startedMs, durationMs: item.durationMs, duration: seconds(item.durationMs) })
      } else if (item.type === 'pulpo_tool') {
        // The command, file, search, or page the tool was pointed at.
        const { command, path, query, url } = item.arguments
        const detail = command ? oneLine(command) : path ?? query ?? url?.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') ?? oneLine(JSON.stringify(item.arguments))
        steps.push({ kind: 'tool', tool: item.tool, detail: detail.slice(0, 160), atMs: startedMs, durationMs: item.durationMs, duration: seconds(item.durationMs) })
      } else if (item.type === 'reasoning') {
        const [, title = '', body = ''] = /^\*\*(.+?)\*\*\s*([\s\S]*)$/.exec(item.summary.map((part) => part.text).join('\n\n')) ?? []
        if (title) steps.push({ kind: 'reasoning', title, text: oneLine(body), durationMs: item.durationMs, duration: seconds(item.durationMs) })
      } else if (item.type === 'pulpo_attachment' && item.mime_type.startsWith('image/') && !attachment) {
        const file = `landing/demo-${scene.id}.${item.mime_type.split('/')[1]}`
        const { url } = (await api('GET', `/api/attachments/${item.attachment_id}/download`)).json
        const bytes = await (await context.request.get(new URL(url, origin).href)).body()
        writeFileSync(publicDirectory + file, bytes)
        // PNG stores its size in the header; other formats fall back to a 4:3 frame.
        const png = bytes.readUInt32BE(0) === 0x89504e47
        const image = png ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : { width: 4, height: 3 }
        attachment = { name: item.name, meta: `${item.name.split('.').pop().toUpperCase()} · ${size(item.size_bytes)}`, src: `/${file}`, width: image.width, height: image.height }
      }
    }
    // Reasoning has no start time of its own: it ran just before the step that follows it.
    steps.forEach((step, index) => {
      if (step.atMs !== undefined) return
      const next = steps.slice(index + 1).find((later) => later.atMs !== undefined)
      const previous = steps[index - 1]
      step.atMs = Math.max(previous ? previous.atMs + previous.durationMs : 0, (next?.atMs ?? completedMs) - step.durationMs)
    })

    // A plain answer may still carry a thought summary; only a workspace run is shown as a trace.
    const agentRan = steps.some((step) => step.kind !== 'reasoning')
    scenes.push({
      id: scene.id,
      model: scene.model,
      ...(scene.speed ? { speed: scene.speed } : {}),
      ...(scene.answerSpeed ? { answerSpeed: scene.answerSpeed } : {}),
      ...(scene.thinkMs ? { thinkMs: scene.thinkMs } : {}),
      ...(scene.streamMs ? { streamMs: scene.streamMs } : {}),
      ...(scene.scroll ? { scroll: scene.scroll } : {}),
      beats: scene.beats,
      title: chat.title,
      response: {
        followMs,
        completedMs,
        titleMs,
        ...(agentRan ? { worked: `${Math.round((Date.parse(response.completedAt) - Date.parse(response.createdAt)) / 1000)} seconds`, steps } : {}),
        ...(attachment ? { attachment } : {}),
        deltas,
      },
    })
    console.log(`${scene.id}: ${describe(answering).name}, first text after ${deltas[0][0]} ms, finished after ${completedMs} ms${agentRan ? `, ${steps.length} steps` : ''}`)
    console.log(text.replace(/^/gm, '  '))
    if (!args['keep-chats']) await api('DELETE', `/api/chats/${chatId}`)
  }

  // Leave the account on the model it started with.
  await openNewChat()
  await selectModel(originalModel)

  const sceneModels = scenes.flatMap((scene) => [scene.model, ...scene.beats.filter((beat) => beat.type === 'pick').map((beat) => beat.model)])
  const favoriteIds = favorites.map((name) => catalog.find((model) => model.name === name)?.id).filter(Boolean)
  for (const model of current.models ?? []) controls[model.id] ??= model.controls
  const next = {
    ...current,
    capturedAt: new Date().toISOString().slice(0, 10),
    instance: new URL(origin).host,
    user: { name: me.name, username: me.username, initials: me.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() },
    // Newest first, as the sidebar lists them.
    sidebar,
    // The picker's favorites, then any other model a scene uses.
    models: [...new Set([...favoriteIds, ...sceneModels])].map(describe),
    // The lab marks down the side of the browser's model list.
    labs: [...new Set(catalog.map((model) => model.lab?.logo).filter(Boolean))].map((logo) => `${logo}.svg`).filter((file) => existsSync(`${publicDirectory}ai-icons/${file}`)).slice(0, 6),
    scenes,
  }
  // Keep each streamed chunk on one line.
  writeFileSync(scriptPath, `${JSON.stringify(next, null, 2).replace(/\[\s+(\d+),\s+("(?:[^"\\]|\\.)*")\s+\]/g, '[$1, $2]')}\n`)
  console.log(`Wrote ${scriptPath}`)
} finally {
  await browser.close()
}
