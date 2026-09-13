import { expect, it } from 'vitest'
import { mergePendingAttachments } from './attachment-order.js'

it('preserves all 500 picker positions as uploads complete, including out of order', () => {
  const original = Array.from({ length: 500 }, (_, id) => ({ id, ready: false }))
  let current = original
  for (let index = 499; index >= 0; index--) {
    current = current.map((item) => item.id === index ? { ...item, ready: true } : item)
    current = mergePendingAttachments(current, current.filter((item) => item.ready), (item) => String(item.id), (item) => !item.ready)
    expect(current.map((item) => item.id)).toEqual(original.map((item) => item.id))
  }
})
it('honors remote removals and reordering without dropping pending uploads', () => {
  const a = { id: 'a', ready: true }, b = { id: 'b', ready: true }, p = { id: 'p', ready: false }
  expect(mergePendingAttachments([a, p, b], [b, a], (item) => item.id, (item) => !item.ready)).toEqual([b, p, a])
  expect(mergePendingAttachments([a, p, b], [], (item) => item.id, (item) => !item.ready)).toEqual([p])
})
