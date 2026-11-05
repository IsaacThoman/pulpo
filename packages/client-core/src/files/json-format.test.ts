import { describe, expect, it } from 'vitest'
import { formatJson, MAX_JSON_FORMAT_CHARACTERS } from './json-format.js'

describe('formatJson', () => {
  it('indents like JSON.stringify for ordinary values', () => {
    const samples = [
      '{"a":1,"b":[1,2,{"c":null}],"d":{},"e":[],"f":"x","g":true,"h":false}',
      '[[],{},[[1]],{"a":{"b":{}}}]',
      '  {\n"nested" :\t[ 1 , 2 ] }  ',
      '"just a string"',
      '42',
      'null',
    ]
    for (const sample of samples) {
      const expected = JSON.stringify(JSON.parse(sample), null, 2)
      expect(formatJson(sample) ?? sample).toBe(expected)
    }
  })

  it('keeps numbers and strings exactly as written', () => {
    expect(formatJson('{"id":9007199254740993,"big":1e400,"f":1.0,"n":-0}')).toBe(
      '{\n  "id": 9007199254740993,\n  "big": 1e400,\n  "f": 1.0,\n  "n": -0\n}',
    )
    expect(formatJson('["caf\\u00e9","a\\"b\\\\",",:{}[]"]')).toBe('[\n  "caf\\u00e9",\n  "a\\"b\\\\",\n  ",:{}[]"\n]')
  })

  it('keeps empty containers on one line, even with whitespace inside', () => {
    expect(formatJson('{"a":{ },"b":[\n]}')).toBe('{\n  "a": {},\n  "b": []\n}')
  })

  it('returns null for invalid, already formatted, or oversized input', () => {
    expect(formatJson('{"a":')).toBeNull()
    expect(formatJson('not json')).toBeNull()
    expect(formatJson('{\n  "a": 1\n}')).toBeNull()
    expect(formatJson(`"${'x'.repeat(MAX_JSON_FORMAT_CHARACTERS)}"`)).toBeNull()
  })

  it('gives up when indentation would grow the file far beyond its size', () => {
    const deep = `${'['.repeat(2_000)}${']'.repeat(2_000)}`
    expect(formatJson(deep)).toBeNull()
    const moderate = `${'['.repeat(100)}1${']'.repeat(100)}`
    expect(formatJson(moderate)).toBe(JSON.stringify(JSON.parse(moderate), null, 2))
  })

  it('drops a leading byte order mark', () => {
    expect(formatJson('﻿{"a":1}')).toBe('{\n  "a": 1\n}')
  })
})
