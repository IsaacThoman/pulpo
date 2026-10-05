const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')

const busboyPath = createRequire(require.resolve('@fastify/multipart')).resolve('@fastify/busboy')

test('Fastify multipart: a fragmented 252-byte boundary mismatch cannot stall the event loop', () => {
  const result = spawnSync(process.execPath, ['-e', `
    const Busboy = require(${JSON.stringify(busboyPath)})
    const boundary = 'A'.repeat(252)
    const parser = new Busboy({ headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } })
    parser.on('error', error => { throw error })
    parser.write(Buffer.from('--' + boundary.slice(0, -1)))
    parser.write(Buffer.from('X'), error => {
      if (error) throw error
      console.log('finished')
    })
  `], { timeout: 3000, encoding: 'utf8' })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), 'finished')
})

for (const header of ['X-Normal', '__proto__', 'constructor']) {
  for (const boundaryLength of [16, 252, 1024]) {
    test(`Fastify multipart: safely handles ${header} with a ${boundaryLength}-byte boundary`, () => {
      // Run out of process so the test can stop a synchronous boundary-search loop.
      const result = spawnSync(process.execPath, ['-e', `
        const assert = require('node:assert/strict')
        const Busboy = require(${JSON.stringify(busboyPath)})
        const boundary = 'b'.repeat(${boundaryLength})
        if (boundary.length > 252) {
          assert.throws(() => new Busboy({ headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } }),
            /needle cannot have a length bigger than 256/)
          console.log('rejected')
          process.exit(0)
        }
        const parser = new Busboy({ headers: { 'content-type': 'multipart/form-data; boundary=' + boundary } })
        const fields = []
        parser.on('field', (name, value) => fields.push([name, value]))
        parser.on('error', error => { throw error })
        parser.on('finish', () => {
          assert.deepEqual(fields, [['message', 'x'.repeat(2048)]])
          console.log('finished')
        })
        parser.end('--' + boundary + '\\r\\nContent-Disposition: form-data; name="message"\\r\\n'
          + ${JSON.stringify(header)} + ': one\\r\\n' + ${JSON.stringify(header)} + ': two\\r\\n\\r\\n'
          + 'x'.repeat(2048) + '\\r\\n--' + boundary + '--\\r\\n')
      `], { timeout: 3000, encoding: 'utf8' })
      assert.equal(result.error, undefined, result.error?.message)
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stdout.trim(), boundaryLength > 252 ? 'rejected' : 'finished')
    })
  }
}
