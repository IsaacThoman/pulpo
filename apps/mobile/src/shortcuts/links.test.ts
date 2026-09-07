import { describe, expect, it } from 'vitest'
import { parseShortcutURL } from './links'
const scope = 'a'.repeat(64)
const id = '00000000-0000-4000-8000-000000000001'
const url = `pulpo://shortcuts?action=open-chat&scope=${scope}&requestId=${id}&chatId=${id}`
describe('Shortcuts navigation links', () => {
  it('opens only explicit navigation destinations', () => {
    expect(parseShortcutURL(url)).toEqual({ action: 'open-chat', scope, requestId: id, chatId: id })
    for (const action of ['new-chat', 'temporary-chat']) {
      expect(parseShortcutURL(`pulpo://shortcuts?action=${action}&scope=${scope}&requestId=${id}`)?.action).toBe(action)
    }
  })
  it.each([
    url.replace('pulpo:', 'https:'), url.replace('shortcuts?', 'evil?'),
    url.replace('shortcuts?', 'shortcuts/path?'), url.replace('open-chat', 'send'),
    `${url}&prompt=send-this`, `${url}&token=secret`, `${url}&server=https://evil.test`,
    `${url}&action=new-chat`, `${url}#fragment`, url.replace(`chatId=${id}`, 'chatId=../other'),
    url.replace(`scope=${scope}`, 'scope=other'), url.replace(`requestId=${id}`, 'requestId=1'),
    url.replace('open-chat', 'temporary-chat'), 'not a URL',
  ])('rejects malformed or action-bearing input: %s', (value) => expect(parseShortcutURL(value)).toBeNull())
})
