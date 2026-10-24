const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { createRequire } = require('node:module')
const { test } = require('node:test')

for (const consumer of ['@pulpo/server', '@electron/get', '@semantic-release/github', 'node-gyp']) {
  const entry = consumer === '@pulpo/server' ? `${consumer}/package.json` : consumer
  const undiciPath = createRequire(require.resolve(entry)).resolve('undici')

  test(`${consumer}: Undici handles an early close after excessive content encodings without crashing`, () => {
    // Isolate the unhandled stream error: the vulnerable release exits even if
    // the caller catches fetch's rejection. Adapted from upstream's regression.
    const result = spawnSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict')
      const { once } = require('node:events')
      const { createServer } = require('node:net')
      const { Client, fetch } = require(${JSON.stringify(undiciPath)})
      ;(async () => {
        let socketClosed
        const closed = new Promise(resolve => { socketClosed = resolve })
        const server = createServer(socket => {
          socket.once('data', request => {
            if (request.toString().startsWith('GET /ok ')) {
              socket.end('HTTP/1.1 200 OK\\r\\nContent-Length: 2\\r\\nConnection: close\\r\\n\\r\\nok')
            } else {
              socket.once('close', socketClosed)
              socket.end('HTTP/1.1 200 OK\\r\\nContent-Encoding: '
                + Array(6).fill('gzip').join(', ')
                + '\\r\\nContent-Length: 1\\r\\nConnection: close\\r\\n\\r\\n')
            }
          })
        })
        await once(server.listen(0, '127.0.0.1'), 'listening')
        const origin = 'http://127.0.0.1:' + server.address().port
        const client = new Client(origin)
        try {
          assert.equal(await (await fetch(origin + '/ok', { dispatcher: client })).text(), 'ok')
          await assert.rejects(fetch(origin + '/attack', { dispatcher: client }), error => {
            assert.match(error.cause?.message, /content-encoding/)
            return true
          })
          await closed
        } finally {
          await client.close()
          server.close()
        }
      })().catch(error => { console.error(error); process.exitCode = 1 })
    `], { timeout: 5000, encoding: 'utf8' })
    assert.equal(result.error, undefined, result.error?.message)
    assert.equal(result.status, 0, result.stderr)
  })
}
