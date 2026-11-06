// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { replaceChildrenWith } from './collections.js'

it('replaces large child lists while preserving node order and identity', () => {
  const target = document.createElement('div')
  target.textContent = 'old'
  const children = Array.from({ length: 1_000 }, (_, index) => document.createTextNode(String(index)))
  replaceChildrenWith(target, children)
  expect(target.childNodes.length).toBe(children.length)
  expect(target.firstChild).toBe(children[0])
  expect(target.lastChild).toBe(children.at(-1))
  // A live NodeList of existing children must also survive being moved to the fragment.
  replaceChildrenWith(target, target.childNodes)
  expect(target.childNodes.length).toBe(children.length)
  expect(target.lastChild).toBe(children.at(-1))
  replaceChildrenWith(target, [])
  expect(target.childNodes.length).toBe(0)
}, 20_000)
