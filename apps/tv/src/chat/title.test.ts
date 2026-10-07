import { expect, it } from 'vitest'
import { splitTitle } from './title'

it('separates a leading emoji from the title', () => {
  expect(splitTitle('🍝 Pasta for dinner')).toEqual({ emoji: '🍝', text: 'Pasta for dinner' })
  expect(splitTitle('👩🏽‍💻 Debugging session')).toEqual({ emoji: '👩🏽‍💻', text: 'Debugging session' })
  expect(splitTitle('🇫🇷 Trip')).toEqual({ emoji: '🇫🇷', text: 'Trip' })
})

it('leaves plain and emoji-only titles intact', () => {
  expect(splitTitle('Plain title')).toEqual({ emoji: null, text: 'Plain title' })
  expect(splitTitle('🎉')).toEqual({ emoji: null, text: '🎉' })
  expect(splitTitle('  ')).toEqual({ emoji: null, text: 'New chat' })
})
