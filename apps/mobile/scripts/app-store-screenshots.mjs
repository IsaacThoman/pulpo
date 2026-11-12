#!/usr/bin/env node
// Captures App Store screenshots of the Release app on simulators, signed in to a real Pulpo instance
// (pulpo.baby by default). It asks the screenshot question once through the API so every device shows the same
// fresh answer, then drives each simulator with agent-device and captures full-resolution PNGs with simctl.
//
//   PULPO_SCREENSHOT_EMAIL=… PULPO_SCREENSHOT_PASSWORD=… npm run screenshots:app-store -w @pulpo/mobile
//
// See `--help` for options. The account should follow the instance's default models (the default model and
// favorites the picker shows); the script warns when it does not.
import { execFile as execFileCallback, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const mobileDirectory = path.resolve(scriptDirectory, '..')
const cacheDirectory = path.join(os.homedir(), '.cache/pulpo/app-store-screenshots')
const bundleId = 'com.isaacthoman.pulpo'
const agentDeviceVersion = '0.21.31'
const iosRuntime = (version) => `com.apple.CoreSimulator.SimRuntime.iOS-${version.replace('.', '-')}`

// One simulator per App Store Connect display category. The iPhone Duo only runs on iOS 27.1.
const DEVICES = [
  { key: 'iphone-dynamic-island-large', label: 'iPhone with Dynamic Island (large)', type: 'iPhone-18-Pro-Max', runtime: '27.0' },
  { key: 'iphone-dynamic-island-medium', label: 'iPhone with Dynamic Island (medium)', type: 'iPhone-18-Pro', runtime: '27.0' },
  { key: 'iphone-face-id-large', label: 'iPhone with Face ID (large)', type: 'iPhone-14-Plus', runtime: '27.0' },
  { key: 'iphone-face-id-medium', label: 'iPhone with Face ID (medium)', type: 'iPhone-17e', runtime: '27.0' },
  { key: 'iphone-home-button', label: 'iPhone with Home Button (medium)', type: 'iPhone-SE-3rd-generation', runtime: '27.0' },
  { key: 'iphone-duo', label: 'iPhone Duo (open)', type: 'iPhone-Duo', runtime: '27.1', foldable: true },
  { key: 'ipad-13', label: 'iPad 13-inch', type: 'iPad-Pro-13-inch-M5-12GB', runtime: '27.0' },
  { key: 'ipad-11', label: 'iPad 11-inch', type: 'iPad-Pro-11-inch-M5-12GB', runtime: '27.0' },
]

const SHOTS = ['01-new-chat', '02-chats', '03-temporary-chat', '04-model-picker', '05-answer', '06-sign-in']

const { values: options } = parseArgs({
  options: {
    devices: { type: 'string' },
    shots: { type: 'string' },
    out: { type: 'string', default: path.join(mobileDirectory, 'app-store-screenshots') },
    instance: { type: 'string', default: process.env.PULPO_INSTANCE_URL ?? 'https://pulpo.baby' },
    question: { type: 'string', default: 'What have the biggest AI model releases been this month?' },
    'answer-model': { type: 'string' },
    'temporary-model': { type: 'string' },
    'reuse-answer': { type: 'boolean', default: false },
    'skip-build': { type: 'boolean', default: false },
    'keep-booted': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

if (options.help) {
  console.log(`Usage: node apps/mobile/scripts/app-store-screenshots.mjs [options]

Environment: PULPO_SCREENSHOT_EMAIL and PULPO_SCREENSHOT_PASSWORD (required).

Options:
  --devices <keys>         Comma-separated subset of: ${DEVICES.map((device) => device.key).join(', ')}
  --shots <names>          Comma-separated subset of: ${SHOTS.join(', ')}
  --out <dir>              Output directory (default: apps/mobile/app-store-screenshots)
  --instance <url>         Pulpo instance (default: https://pulpo.baby)
  --question <text>        Question asked for the answer screenshot
  --answer-model <id>      Model that answers (default: a non-default favorite, preferring Anthropic's)
  --temporary-model <id>   Model shown in the temporary chat (default: the DeepSeek favorite, else another favorite)
  --reuse-answer           Reuse the answer chat from the previous run instead of asking again
  --skip-build             Reuse the last simulator build instead of building this checkout
  --keep-booted            Leave the simulators booted afterwards`)
  process.exit(0)
}

const email = process.env.PULPO_SCREENSHOT_EMAIL
const password = process.env.PULPO_SCREENSHOT_PASSWORD
if (!email || !password) fail('Set PULPO_SCREENSHOT_EMAIL and PULPO_SCREENSHOT_PASSWORD.')
const instance = options.instance.replace(/\/+$/, '')
const selectedDevices = pick(DEVICES.map((device) => device.key), options.devices, '--devices')
  .map((key) => DEVICES.find((device) => device.key === key))
const selectedShots = new Set(pick(SHOTS, options.shots, '--shots'))

function pick(all, list, flag) {
  if (!list) return all
  const chosen = list.split(',').map((value) => value.trim()).filter(Boolean)
  const unknown = chosen.filter((value) => !all.includes(value))
  if (unknown.length) fail(`Unknown ${flag}: ${unknown.join(', ')}. Choose from ${all.join(', ')}.`)
  return chosen
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

const log = (message) => console.log(`[${new Date().toLocaleTimeString()}] ${message}`)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------------------------------------------------------
// Pulpo API: read the account's default models and ask the question once.

let token = null
async function api(method, pathname, body) {
  const response = await fetch(`${instance}${pathname}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`${method} ${pathname} failed (${response.status}): ${text.slice(0, 500)}`)
  return text ? JSON.parse(text) : null
}

async function signIn() {
  const result = await api('POST', '/api/mobile/auth/login', {
    email, password, deviceLabel: 'App Store screenshot script', appType: 'mobile', platform: 'ios',
  })
  token = result.session.token
  return result.user
}

async function signOut() {
  if (!token) return
  await api('POST', '/api/mobile/auth/logout').catch(() => undefined)
  token = null
}

async function readModels() {
  const [{ data: catalog }, settings] = await Promise.all([api('GET', '/api/models'), api('GET', '/api/settings')])
  const byId = new Map(catalog.filter((model) => model.visible !== false).map((model) => [model.id, model]))
  const followed = settings.followedModelDefaults ?? {}
  if (!followed.defaultModelId || !followed.favoriteModelIds) {
    console.warn('Warning: this account overrides the instance default model or favorites, so the screenshots '
      + 'show its own choices rather than the instance defaults.')
  }
  const defaultModel = byId.get(settings.values.defaultModelId)
  if (!defaultModel) throw new Error(`Default model ${settings.values.defaultModelId} is not in the catalog.`)
  const favorites = (settings.values.favoriteModelIds ?? []).map((id) => byId.get(id)).filter(Boolean)
  const others = favorites.filter((model) => model.id !== defaultModel.id)
  const fromLab = (lab) => others.find((model) => model.lab?.name === lab)
  const chosen = (id, fallback) => {
    if (!id) return fallback
    const model = byId.get(id)
    if (!model) throw new Error(`Model ${id} is not in the catalog.`)
    return model
  }
  const answerModel = chosen(options['answer-model'], fromLab('Anthropic') ?? others[0] ?? defaultModel)
  const temporaryModel = chosen(options['temporary-model'],
    fromLab('DeepSeek') ?? [...others].reverse().find((model) => model.id !== answerModel.id) ?? defaultModel)
  return { defaultModel, favorites, answerModel, temporaryModel }
}

const statePath = path.join(cacheDirectory, 'state.json')
async function readState() {
  try { return JSON.parse(await readFile(statePath, 'utf8')) } catch { return {} }
}

async function chatTitle(chatId) {
  const chat = await api('GET', `/api/chats/${chatId}?format=compact&scope=active`)
  return chat.title
}

async function askQuestion(model) {
  const state = await readState()
  const previous = state[instance]?.answerChatId
  if (options['reuse-answer'] && previous) {
    const title = await chatTitle(previous).catch(() => null)
    if (title) {
      log(`Reusing the previous answer chat “${title}”.`)
      return { chatId: previous, title }
    }
  }
  const chatId = randomUUID()
  log(`Asking ${model.name}: “${options.question}”`)
  const started = await api('POST', '/api/chats/start', {
    chat: { clientId: chatId, modelId: model.id },
    response: {
      clientId: randomUUID(),
      modelId: model.id,
      input: options.question,
      agentMode: Boolean(model.agentEnabled),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  })
  const responseId = started.response.responseId
  const deadline = Date.now() + 10 * 60_000
  let status = started.response.status
  while (['queued', 'in_progress'].includes(status)) {
    if (Date.now() > deadline) throw new Error('The answer did not finish within 10 minutes.')
    await sleep(3000)
    status = (await api('GET', `/api/responses/${responseId}`)).status
  }
  if (status !== 'completed') throw new Error(`The answer ended with status “${status}”.`)
  let title = 'New chat'
  for (let attempt = 0; attempt < 30 && title === 'New chat'; attempt += 1) {
    await sleep(2000)
    title = await chatTitle(chatId)
  }
  log(`Answered in chat “${title}”.`)
  // Replace the previous run's chat so screenshot runs don't pile up in the account's history.
  if (previous && previous !== chatId) {
    await api('DELETE', `/api/chats/${previous}`).catch(() => undefined)
    await api('DELETE', `/api/chats/${previous}/permanent`).catch(() => undefined)
  }
  await mkdir(cacheDirectory, { recursive: true })
  await writeFile(statePath, JSON.stringify({ ...state, [instance]: { answerChatId: chatId } }, null, 2))
  return { chatId, title }
}

// ---------------------------------------------------------------------------------------------------------------
// Build: one Release simulator app for every device, built in the shared serialized build directory.

const appPath = path.join(cacheDirectory, 'Pulpo.app')

async function run(command, args, { quiet = false, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit' })
    let output = ''
    child.stdout?.on('data', (chunk) => { output += chunk })
    child.stderr?.on('data', (chunk) => { output += chunk })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(`${command} ${args.join(' ')} exited ${code}\n${output.slice(-4000)}`)))
  })
}

async function simctl(...args) {
  const { stdout } = await execFile('xcrun', ['simctl', ...args], { maxBuffer: 64 * 1024 * 1024 })
  return stdout
}

async function buildApp(buildDevice) {
  if (options['skip-build']) {
    if (!existsSync(appPath)) fail(`--skip-build needs an earlier build at ${appPath}.`)
    log(`Using the existing build at ${appPath}.`)
    return
  }
  log('Building the Release simulator app (waits for the shared build lock; the first build takes a while)…')
  await run('python3', [path.join(scriptDirectory, 'deploy-iphone.py')], {
    env: {
      ...process.env,
      PULPO_INSTANCE_URL: instance,
      PULPO_IOS_BUILD_ROOT: process.env.PULPO_IOS_BUILD_ROOT ?? path.join(os.homedir(), '.cache/pulpo/simulator-build'),
      PULPO_IOS_DEVICE: buildDevice.udid,
      PULPO_IOS_SIMULATOR: '1',
      PULPO_IOS_DEPLOY_LOG: path.join(cacheDirectory, 'build.log'),
    },
  })
  // Copy the build from the simulator it was installed on, never from the shared DerivedData, which another
  // worktree's build may overwrite as soon as the lock is released.
  const installed = (await simctl('get_app_container', buildDevice.udid, bundleId, 'app')).trim()
  await rm(appPath, { recursive: true, force: true })
  await run('cp', ['-R', installed, appPath])
  log(`Saved the build to ${appPath}.`)
}

// ---------------------------------------------------------------------------------------------------------------
// Simulators

// Each device gets its own named simulator, so runs never disturb simulators other sessions are using.
async function ensureSimulator(device) {
  const name = `Pulpo Screenshots ${device.key}`
  const { devices } = JSON.parse(await simctl('list', 'devices', '-j'))
  const existing = Object.values(devices).flat().find((candidate) => candidate.name === name && candidate.isAvailable)
  device.udid = existing?.udid
    ?? (await simctl('create', name, `com.apple.CoreSimulator.SimDeviceType.${device.type}`, iosRuntime(device.runtime))).trim()
}

async function bootSimulator(device) {
  await simctl('boot', device.udid).catch(() => undefined) // already booted
  await simctl('bootstatus', device.udid, '-b')
  await simctl('ui', device.udid, 'appearance', 'dark')
  await simctl('status_bar', device.udid, 'override', '--time', '9:41', '--dataNetwork', 'wifi', '--wifiMode', 'active',
    '--wifiBars', '3', '--cellularMode', 'active', '--cellularBars', '4', '--operatorName', '',
    '--batteryState', 'discharging', '--batteryLevel', '100')
}

async function freshInstall(device) {
  await simctl('terminate', device.udid, bundleId).catch(() => undefined)
  await simctl('uninstall', device.udid, bundleId).catch(() => undefined)
  // The session token lives in the keychain, which survives an uninstall.
  await simctl('keychain', device.udid, 'reset')
  await simctl('install', device.udid, appPath)
}

// ---------------------------------------------------------------------------------------------------------------
// agent-device drives the UI through accessibility labels; simctl takes the full-resolution captures.

const agentDeviceRoot = path.join(os.homedir(), `.cache/pulpo/agent-device-${agentDeviceVersion}`)
const agentDeviceBin = path.join(agentDeviceRoot, 'node_modules/agent-device/bin/agent-device.mjs')

async function ensureAgentDevice() {
  if (existsSync(agentDeviceBin)) return
  log(`Installing agent-device ${agentDeviceVersion}…`)
  await run('npm', ['install', '--prefix', agentDeviceRoot, '--no-save', '--no-audit', '--no-fund', `agent-device@${agentDeviceVersion}`], { quiet: true })
}

function agent(device) {
  const target = ['--platform', 'ios', '--udid', device.udid, '--session', `pulpo-screenshots-${device.key}`]
  const call = async (args, { allowFailure = false } = {}) => {
    try {
      const { stdout } = await execFile(process.execPath, [agentDeviceBin, ...args, ...target, '--json'], { maxBuffer: 64 * 1024 * 1024 })
      return JSON.parse(stdout).data
    } catch (error) {
      if (allowFailure) return null
      const detail = (() => { try { return JSON.parse(error.stdout).error?.message } catch { return error.stdout || error.message } })()
      throw new Error(`agent-device ${args.join(' ')} failed on ${device.key}: ${detail}`, { cause: error })
    }
  }
  // Transitions briefly keep the outgoing screen in the tree, so retry selectors that match twice.
  const settle = async (args) => {
    for (let attempt = 1; ; attempt += 1) {
      try { return await call(args) } catch (error) {
        if (attempt >= 4 || !/matched \d+ distinct/.test(error.message)) throw error
        await sleep(1000)
      }
    }
  }
  const selector = (label) => `label=${JSON.stringify(label)}`
  return {
    open: () => call(['open', bundleId, '--relaunch', '--timeout', '600000']),
    close: () => call(['close'], { allowFailure: true }),
    // The iPhone Duo's windowed app briefly has no viewport after a capture or pose change.
    snapshot: async () => {
      for (let attempt = 1; ; attempt += 1) {
        try { return await call(['snapshot', '-i']) } catch (error) {
          if (attempt >= 6 || !/viewport/.test(error.message)) throw error
          await sleep(1500)
        }
      }
    },
    // XCTest-backed trees wrap a control in a same-label container, so target the button itself.
    press: (label) => settle(['press', `role=button ${selector(label)}`]),
    pressPoint: (x, y) => call(['press', String(Math.round(x)), String(Math.round(y))]),
    type: (text) => call(['type', text]),
    wait: (label, ms = 30_000) => call(['wait', selector(label), String(ms)]),
    waitText: (text, ms = 30_000) => call(['wait', 'text', text, String(ms)]),
    fold: (pose) => call(['fold', pose], { allowFailure: true }),
    scroll: (direction) => call(['scroll', direction], { allowFailure: true }),
    screenshot: (file, density) => call(['screenshot', file, '--pixel-density', String(density)]),
  }
}

const findNode = (snapshot, predicate) => snapshot.nodes.find(predicate)
const hasLabel = (snapshot, label) => Boolean(findNode(snapshot, (node) => node.label === label))

async function capture(device, ui, shot, outDirectory) {
  if (!selectedShots.has(shot)) return
  await sleep(1200) // let menus and transitions finish animating
  const file = path.join(outDirectory, `${shot}.png`)
  // simctl captures a foldable's raw portrait framebuffer for whichever display it picks; agent-device captures
  // the lit panel in the app's orientation.
  if (device.foldable) await ui.screenshot(file, 3)
  else await simctl('io', device.udid, 'screenshot', '--type=png', file)
  log(`  ${device.key}: ${shot}.png`)
}

// ---------------------------------------------------------------------------------------------------------------
// The screenshot flow for one device.

async function captureDevice(device, models, answer) {
  const outDirectory = path.join(options.out, device.key)
  await mkdir(outDirectory, { recursive: true })
  await rm(path.join(outDirectory, 'failure.png'), { force: true })
  log(`${device.label}: preparing ${device.key} (${device.udid})`)
  await bootSimulator(device)
  await freshInstall(device)
  const ui = agent(device)
  try {
    await ui.open()
    if (device.foldable) {
      // Panel geometry changes with the pose, so unfold before reading any layout.
      await ui.fold('open')
      await sleep(3000)
    }

    await ui.wait('Email', 60_000)
    await capture(device, ui, '06-sign-in', outDirectory)
    // `fill` verifies by reading the field back, which fails in the iPhone Duo's windowed app, so focus each
    // field with a tap and type into it.
    const enter = async (label, text) => {
      const field = findNode(await ui.snapshot(), (node) => node.label === label && /text/i.test(node.type ?? ''))
      if (!field) throw new Error(`No ${label} field on ${device.key}.`)
      await ui.pressPoint(field.rect.x + field.rect.width / 2, field.rect.y + field.rect.height / 2)
      await sleep(500)
      await ui.type(text)
    }
    await enter('Email', email)
    await enter('Password', password)
    await ui.press('Sign in')
    // iOS offers to save the password after a sign-in, sometimes only after the chat screen appears. Decline it
    // whenever it shows up so it never covers the app.
    let snapshot
    for (const deadline = Date.now() + 90_000; ; await sleep(1500)) {
      snapshot = await ui.snapshot()
      if (hasLabel(snapshot, 'Not Now')) await ui.press('Not Now')
      else if (hasLabel(snapshot, 'Send message')) break
      if (Date.now() > deadline) throw new Error(`Sign-in did not reach the chat screen on ${device.key}.`)
    }
    await sleep(2000)
    snapshot = await ui.snapshot()
    if (hasLabel(snapshot, 'Not Now')) {
      await ui.press('Not Now')
      snapshot = await ui.snapshot()
    }
    const { width, height } = snapshot.viewport ?? findNode(snapshot, (node) => node.kind === 'application').rect
    const persistentSidebar = hasLabel(snapshot, 'Hide chats sidebar')
    // Tapping empty space above the landing content ends editing, which reveals the prompt suggestions.
    const blankPoint = persistentSidebar ? [width * 0.7, height * 0.2] : [width * 0.5, height * 0.25]
    const blur = async () => { await ui.pressPoint(...blankPoint); await sleep(800) }
    const waitForNode = async (predicate, ms, what) => {
      for (const deadline = Date.now() + ms; ; await sleep(1000)) {
        const node = findNode(await ui.snapshot(), predicate)
        if (node) return node
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what} on ${device.key}.`)
      }
    }

    // The last model used syncs across devices, so always choose the default explicitly.
    const chooseModel = async (model) => {
      snapshot = await ui.snapshot()
      const button = findNode(snapshot, (node) => node.label?.startsWith('Model, '))
      if (!button) throw new Error(`No model picker on ${device.key}.`)
      await ui.pressPoint(button.rect.x + button.rect.width / 2, button.rect.y + button.rect.height / 2)
      await ui.wait(model.name, 10_000)
      return () => ui.press(model.name)
    }
    await (await chooseModel(models.defaultModel))()
    await ui.wait(`Model, ${models.defaultModel.name}`, 10_000)
    await blur()
    await capture(device, ui, '01-new-chat', outDirectory)

    await chooseModel(models.defaultModel)
    await capture(device, ui, '04-model-picker', outDirectory)
    await ui.press(models.temporaryModel.name)
    await ui.wait(`Model, ${models.temporaryModel.name}`, 10_000)
    // The header exposes temporary chat as a switch whose value reads On or Off. The accessibility bridge calls it
    // a Toggle and XCTest (used on the iPhone Duo) a Switch.
    const temporarySwitch = (node) => ['Toggle', 'Switch'].includes(node.type) && node.label === 'Temporary chat'
    const setTemporary = async (on) => {
      const toggle = await waitForNode(temporarySwitch, 10_000, 'the temporary chat switch')
      await ui.pressPoint(toggle.rect.x + toggle.rect.width / 2, toggle.rect.y + toggle.rect.height / 2)
      await waitForNode((node) => temporarySwitch(node) && node.value === (on ? 'On' : 'Off'), 10_000, 'temporary chat to switch')
    }
    await setTemporary(true)
    await blur()
    await capture(device, ui, '03-temporary-chat', outDirectory)
    await setTemporary(false)
    // Leave the account's synced composer model on the default again.
    await (await chooseModel(models.defaultModel))()

    if (!answer.title) return
    if (!persistentSidebar) await ui.press('Open chats')
    // Drawer rows read "<title>, <time>", plus the expiry when the chat has one.
    const answerRow = (node) => node.type === 'Button' && (node.label === answer.title || node.label?.startsWith(`${answer.title}, `))
    await waitForNode(answerRow, 60_000, `the chat “${answer.title}”`)
    if (!persistentSidebar) await capture(device, ui, '02-chats', outDirectory)
    const row = await waitForNode(answerRow, 10_000, `the chat “${answer.title}”`)
    await ui.pressPoint(row.rect.x + row.rect.width / 2, row.rect.y + row.rect.height / 2)
    await ui.waitText(options.question, 60_000)
    await sleep(2500) // markdown and model icons render after the transcript arrives
    // Chats open at the latest message; start from the question like a reader would.
    await ui.scroll('top')
    await capture(device, ui, '05-answer', outDirectory)
  } finally {
    await ui.close()
  }
}

// ---------------------------------------------------------------------------------------------------------------

async function main() {
  await mkdir(cacheDirectory, { recursive: true })
  const user = await signIn()
  let answer
  let models
  try {
    log(`Signed in to ${instance} as ${user.email}.`)
    models = await readModels()
    log(`Default model: ${models.defaultModel.name}. Favorites: ${models.favorites.map((model) => model.name).join(', ')}.`)
    log(`Answer model: ${models.answerModel.name}. Temporary chat model: ${models.temporaryModel.name}.`)
    if (selectedShots.has('05-answer') || selectedShots.has('02-chats')) answer = await askQuestion(models.answerModel)
  } finally {
    await signOut()
  }
  answer ??= { title: '', chatId: null }

  await ensureAgentDevice()
  for (const device of selectedDevices) await ensureSimulator(device)
  if (!options['skip-build']) await bootSimulator(selectedDevices[0])
  await buildApp(selectedDevices[0])

  const failures = []
  for (const device of selectedDevices) {
    try {
      await captureDevice(device, models, answer)
    } catch (error) {
      failures.push(device.key)
      console.error(`${device.key} failed: ${error.message}`)
      await simctl('io', device.udid, 'screenshot', '--type=png', path.join(options.out, device.key, 'failure.png')).catch(() => undefined)
    }
    if (!options['keep-booted']) await simctl('shutdown', device.udid).catch(() => undefined)
  }
  log(`Screenshots are in ${options.out}`)
  if (failures.length) fail(`Failed devices: ${failures.join(', ')}`)
}

await main()
