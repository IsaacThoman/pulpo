import assert from 'node:assert/strict'
import { newestDescendantId } from '../../packages/client-core/dist/index.js'

// Frozen pre-fix algorithm, measured against the current client-core build.
function scanning(nodes, selectedId) {
  let leafId = selectedId
  for (;;) {
    const newest = nodes.filter(node => node.parentResponseId === leafId).at(-1)
    if (!newest) return leafId
    leafId = newest.id
  }
}
for (const count of [1000, 5000, 20000]) {
  const rows = Array.from({ length: count }, (_, i) => ({ id: String(i), parentResponseId: i ? String(i - 1) : null }))
  const measurements = {}
  for (const [name, select] of [['scanning', scanning], ['indexed', newestDescendantId]]) {
    const samples = []
    for (let i = 0; i < 4; i++) {
      const start = performance.now()
      const leaf = select(rows, '0')
      if (i) samples.push(performance.now() - start)
      assert.equal(leaf, String(count - 1))
    }
    measurements[name] = samples.sort((a, b) => a - b)[1]
  }
  console.log(JSON.stringify({ responses: count, medianMs: measurements }))
}
