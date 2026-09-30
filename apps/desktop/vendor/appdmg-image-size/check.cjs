const assert = require('node:assert/strict')
const { mkdtemp, writeFile, rm } = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { test } = require('node:test')
const sizeOf = require('./index.cjs')

test('reads DMG background dimensions through the callback API', async () => {
  const dimensions = await promisify(sizeOf)(path.join(__dirname, '../../../mobile/assets/pulpo-app-icon.png'))
  assert.ok(dimensions.width > 0)
  assert.ok(dimensions.height > 0)
  assert.equal(dimensions.type, 'png')
})

test('reports file errors through the callback', async () => {
  await assert.rejects(promisify(sizeOf)(path.join(__dirname, 'missing.png')), { code: 'ENOENT' })
})

test('rejects an ICNS entry with zero length instead of looping', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pulpo-image-size-'))
  try {
    const file = path.join(directory, 'malformed.icns')
    const bytes = Buffer.alloc(16)
    bytes.write('icns')
    bytes.writeUInt32BE(bytes.length, 4)
    bytes.write('ic07', 8)
    await writeFile(file, bytes)
    await assert.rejects(promisify(sizeOf)(file))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
