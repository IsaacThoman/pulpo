// Run with Electron after `npm run package`; uses only a disposable local host.
const { app, BrowserWindow, Menu, Tray, nativeImage, utilityProcess } = require('electron')
const { createServer } = require('node:http')
const { Server } = require('socket.io')
const { mkdtemp, rm } = require('node:fs/promises')
const { randomUUID, createHash } = require('node:crypto')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const packageFolder = path.resolve(__dirname, `../out/Pulpo-${process.platform}-${process.arch}`)
const resources = process.platform === 'darwin' ? path.join(packageFolder, 'Pulpo.app/Contents/Resources') : path.join(packageFolder, 'resources')
const asar = path.join(resources, 'app.asar')
let child, tray, window, gateway, folder
const deadline = setTimeout(() => { console.error('Packaged workspace smoke timed out'); app.exit(1) }, 40000)
app.whenReady().then(async () => {
  folder = await mkdtemp(path.join(os.tmpdir(), 'pulpo-package-smoke-'))
  const server = createServer(); gateway = new Server(server)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const rootId = randomUUID(), sessionId = randomUUID()
  const make = (type, args) => ({ id: randomUUID(), generation: 0, rootId, sessionId, type, args, deadline: new Date(Date.now() + 20000).toISOString(), hash: createHash('sha256').update(JSON.stringify({ args: Object.fromEntries(Object.entries(args).sort(([a], [b]) => a.localeCompare(b, 'en'))), type })).digest('hex') })
  const operations = [make('write', { path: 'smoke.txt', content: 'packaged host works' }), make('grep', { pattern: 'packaged', path: 'smoke.txt' }), make('export', { path: 'smoke.txt' }), make('bash', { command: process.platform === 'win32' ? 'Start-Sleep -Seconds 30' : 'sleep 30' })]
  let index = 0, cancel = false
  const finished = new Promise((resolve, reject) => {
    gateway.of('/workspaces').on('connection', socket => {
      assert.equal(socket.handshake.auth.token, 'local-smoke-token')
      socket.on('poll', ack => ack({ operations: cancel ? [] : [operations[index]], cancel: cancel ? [operations[index].id] : [] }))
      socket.on('result', (result, ack) => {
        ack?.({ ok: true })
        if (result.id !== operations[index]?.id) return
        if (result.status === 'running') { if (index === 3) cancel = true; return }
        try {
          assert.equal(result.status, index === 3 ? 'cancelled' : 'completed')
          if (index === 1) assert.match(result.output, /packaged host works/)
          if (index === 2) assert.equal(Buffer.from(result.output, 'base64').toString(), 'packaged host works')
          if (++index === operations.length) resolve()
        } catch (error) { reject(error) }
      })
    })
  })
  const icon = nativeImage.createFromPath(path.join(resources, 'assets', 'tray.png')).resize({ width: 18, height: 18 })
  assert.equal(icon.isEmpty(), false)
  tray = new Tray(icon); tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Workspace online', enabled: false }, { label: 'Open Pulpo' }, { label: 'Disable hosting' }, { label: 'Quit Pulpo' }]))
  window = new BrowserWindow({ show: false }); window.on('close', event => { event.preventDefault(); window.hide() }); window.close(); assert.equal(window.isDestroyed(), false)
  child = utilityProcess.fork(path.join(asar, '.vite/build/workspace-host-worker.js'), [], { serviceName: 'Pulpo workspace smoke', stdio: 'pipe' })
  child.stderr?.on('data', data => process.stderr.write(data))
  child.postMessage({ type: 'start', instanceUrl: `http://127.0.0.1:${server.address().port}`, token: 'local-smoke-token', config: { journal: path.join(folder, 'journal'), stagingPath: path.join(folder, 'staging'), roots: [{ id: rootId, path: folder }], shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash', rgPath: path.join(resources, process.platform === 'win32' ? 'rg.exe' : 'rg') } })
  await finished
  const stopped = new Promise(resolve => child.once('exit', resolve)); child.postMessage({ type: 'stop' }); await stopped
  console.log('PASS packaged utility service, bundled search, file export, process cancellation, tray creation and window retention')
}).then(() => finish(0), error => { console.error(error); return finish(1) })
async function finish(code) {
  clearTimeout(deadline); child?.kill(); tray?.destroy(); window?.destroy(); await gateway?.close(); if (folder) await rm(folder, { recursive: true, force: true }); app.exit(code)
}
