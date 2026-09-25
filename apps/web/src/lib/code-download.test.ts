import { describe, expect, it } from 'vitest'
import { codeFileExtension } from './code-download'

describe('codeFileExtension', () => {
  it.each([
    ['python', 'py'],
    ['TypeScript', 'ts'],
    ['tsx', 'tsx'],
    ['c++', 'cpp'],
    ['C#', 'cs'],
    ['bash', 'sh'],
    ['html', 'html'],
    ['yaml', 'yaml'],
    ['latex', 'tex'],
    ['', 'txt'],
    [undefined, 'txt'],
    ['brainfuck', 'txt'],
  ])('%s -> %s', (language, expected) => {
    expect(codeFileExtension(language)).toBe(expected)
  })
})
