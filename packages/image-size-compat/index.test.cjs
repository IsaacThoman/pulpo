const assert = require('node:assert/strict')
const { mkdtemp, writeFile, rm } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { createRequire } = require('node:module')
const { execFile } = require('node:child_process')
const { test } = require('node:test')
const sizeOf = promisify(require('./index.cjs'))

test('appdmg resolves the patched compatibility adapter', { skip: process.platform !== 'darwin' }, () => {
  const appdmgRequire = createRequire(require.resolve('appdmg'))
  assert.equal(appdmgRequire('image-size'), require('./index.cjs'))
})

test('reads a PNG through the callback API used by appdmg', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pulpo-image-size-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const filename = path.join(directory, 'background.png')
  await writeFile(filename, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHosAAAAASUVORK5CYII=', 'base64'))
  assert.deepEqual(await sizeOf(filename), { width: 1, height: 1, type: 'png' })
})

test('returns file errors through the callback', async () => {
  await assert.rejects(sizeOf(path.join(os.tmpdir(), 'pulpo-missing-image', 'background.png')), { code: 'ENOENT' })
})

test('rejects an ICNS chunk with zero length instead of looping', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pulpo-image-size-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const filename = path.join(directory, 'malformed.icns')
  const data = Buffer.alloc(16)
  data.write('icns', 0)
  data.writeUInt32BE(data.length, 4)
  data.write('ic07', 8)
  await writeFile(filename, data)
  // Run the parser in a child: a synchronous parser loop would prevent an
  // in-process test timeout from firing.
  const script = `require(${JSON.stringify(require.resolve('./index.cjs'))})(process.argv[1], (error) => {
    process.exit(error ? 0 : 1)
  })`
  await promisify(execFile)(process.execPath, ['-e', script, filename], { timeout: 2000 })
})
