import { describe, expect, it } from 'vitest'
import { decodeFileText, formattedJson, inAppViewer, viewerLines } from './content'

describe('in-app viewers', () => {
  it('picks a viewer by name and type', () => {
    expect(inAppViewer('sales.csv')).toBe('table')
    expect(inAppViewer('export', 'text/tab-separated-values')).toBe('table')
    expect(inAppViewer('analysis.ipynb')).toBe('notebook')
    expect(inAppViewer('main.py', 'application/octet-stream')).toBe('text')
    expect(inAppViewer('Dockerfile')).toBe('text')
    expect(inAppViewer('page.html', 'text/html')).toBeNull()
    expect(inAppViewer('notes.md')).toBeNull()
    expect(inAppViewer('Budget.xlsx')).toBeNull()
  })

  it('decodes legacy encodings', () => {
    expect(decodeFileText(new Uint8Array([0x43, 0x61, 0x66, 0xe9]))).toBe('Café')
    expect(decodeFileText(new Uint8Array([0xff, 0xfe, 0x41, 0x00]))).toBe('A')
  })

  it('highlights code into lines and keeps plain lines for find', () => {
    const { lines, plain, highlighted } = viewerLines('def f():\r\n    return 1\n', 'f.py')
    expect(highlighted).toBe(true)
    expect(plain).toEqual(['def f():', '    return 1', ''])
    expect(lines).toHaveLength(3)
    expect(viewerLines('a,b', 'x.csv', null, null).highlighted).toBe(false)
  })

  it('pretty-prints JSON only when it changes something', () => {
    expect(formattedJson('{"a":1}', 'x.json')).toBe('{\n  "a": 1\n}')
    expect(formattedJson('{\n  "a": 1\n}', 'x.json')).toBeNull()
    expect(formattedJson('{"a":1}\n{"b":2}', 'x.jsonl')).toBeNull()
    expect(formattedJson('{oops', 'x.json')).toBeNull()
  })
})
