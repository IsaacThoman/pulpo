import { describe, expect, it } from 'vitest'
import { matchingComposerCommands, parseComposerCommand } from './composer-commands'

describe('parseComposerCommand', () => {
  it('reads /btw and its question', () => {
    expect(parseComposerCommand('/btw what does this regex do?')).toEqual({ kind: 'btw', question: 'what does this regex do?' })
    expect(parseComposerCommand('  /BTW\nline one\nline two  ')).toEqual({ kind: 'btw', question: 'line one\nline two' })
    expect(parseComposerCommand('/btw')).toEqual({ kind: 'btw', question: '' })
  })

  it('reads /fork only on its own', () => {
    expect(parseComposerCommand('/fork')).toEqual({ kind: 'fork' })
    expect(parseComposerCommand(' /fork \n')).toEqual({ kind: 'fork' })
    expect(parseComposerCommand('/fork this please')).toBeNull()
  })

  it('leaves other messages that start with a slash alone', () => {
    expect(parseComposerCommand('/btwx hello')).toBeNull()
    expect(parseComposerCommand('/usr/bin/env node')).toBeNull()
    expect(parseComposerCommand('/help')).toBeNull()
    expect(parseComposerCommand('see /btw later')).toBeNull()
  })

  it('takes only the commands available in the chat', () => {
    expect(parseComposerCommand('/btw hi', ['fork'])).toBeNull()
    expect(parseComposerCommand('/fork', [])).toBeNull()
  })
})

describe('matchingComposerCommands', () => {
  it('suggests commands while their name is typed', () => {
    expect(matchingComposerCommands('/')).toEqual(['btw', 'fork'])
    expect(matchingComposerCommands('/f')).toEqual(['fork'])
    expect(matchingComposerCommands('/btw')).toEqual(['btw'])
    expect(matchingComposerCommands('/x')).toEqual([])
    expect(matchingComposerCommands('/', ['fork'])).toEqual(['fork'])
  })

  it('keeps /btw while its question is typed, and nothing after other text', () => {
    expect(matchingComposerCommands('/btw why')).toEqual(['btw'])
    expect(matchingComposerCommands('/fork now')).toEqual([])
    expect(matchingComposerCommands('hello /btw')).toEqual([])
    expect(matchingComposerCommands('/usr/bin')).toEqual([])
  })
})
