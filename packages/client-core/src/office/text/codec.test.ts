import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { MemoryLiveAssetStore } from '../assets.js'
import { LiveFormatError } from '../live-format.js'
import { textCodec, textFileFacts, textOf } from './codec.js'
import { decodeTextFile, encodeTextFile } from './encoding.js'
import { TEXT_MAX_FILE_BYTES } from './layout.js'

const bytesOf = (...parts: Array<number[] | string>) => {
  const chunks = parts.map((part) => typeof part === 'string' ? new TextEncoder().encode(part) : Uint8Array.from(part))
  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}

function utf16(text: string, littleEndian: boolean): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2)
  bytes.set(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff])
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    bytes[2 + index * 2] = littleEndian ? code & 0xff : code >> 8
    bytes[3 + index * 2] = littleEndian ? code >> 8 : code & 0xff
  }
  return bytes
}

async function imported(bytes: Uint8Array, name = 'file.txt', assets = new MemoryLiveAssetStore()) {
  const doc = new Y.Doc()
  await textCodec.importFile(doc, bytes, { name, assets })
  return { doc, assets, context: { name, assets } }
}

async function roundTrip(bytes: Uint8Array): Promise<Uint8Array> {
  const { doc, context } = await imported(bytes)
  // Through a second replica, as a client would receive it.
  const replica = new Y.Doc()
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(doc))
  return textCodec.exportFile(replica, context)
}

describe('text encodings', () => {
  const samples: Array<[string, Uint8Array]> = [
    ['UTF-8', bytesOf('héllo\nwörld\n')],
    ['UTF-8 without a final newline', bytesOf('one\ntwo')],
    ['UTF-8 with a byte order mark', bytesOf([0xef, 0xbb, 0xbf], 'bom\n')],
    ['CRLF', bytesOf('a\r\nb\r\n\r\nc\r\n')],
    ['CR', bytesOf('a\rb\rc')],
    ['UTF-16 LE', utf16('ﬁne ✓\r\nline 2\r\n', true)],
    ['UTF-16 BE', utf16('big endian 😀\n', false)],
    ['Windows-1252', bytesOf([0x63, 0x61, 0x66, 0xe9, 0x20, 0x80, 0x20, 0x93, 0x71, 0x94, 0x0d, 0x0a])],
    ['mixed line breaks', bytesOf('a\r\nb\nc\rd\r\n')],
    ['an empty file', new Uint8Array()],
    ['tabs, a form feed, and an escape', bytesOf('\tcol\f\x1b[0m\n')],
  ]
  for (const [label, bytes] of samples) {
    it(`round-trips ${label} byte for byte`, async () => {
      expect(Array.from(await roundTrip(bytes))).toEqual(Array.from(bytes))
    })
  }

  it('decodes the facts it keeps', () => {
    expect(decodeTextFile(bytesOf('a\r\nb\r\nc\n'))).toMatchObject({ text: 'a\nb\nc\n', encoding: 'utf-8', lineEnding: 'crlf', mixed: true })
    expect(decodeTextFile(bytesOf('single line'))).toMatchObject({ lineEnding: 'lf', mixed: false })
    expect(decodeTextFile(bytesOf([0x80, 0x41])).encoding).toBe('windows-1252')
    expect(decodeTextFile(bytesOf([0x80, 0x41])).text).toBe('€A')
  })

  it('refuses binary files', () => {
    const png = bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d])
    expect(() => decodeTextFile(png)).toThrow(LiveFormatError)
    const controls = Uint8Array.from({ length: 4_000 }, (_, index) => index % 7 === 0 ? 0x01 : 0x41)
    expect(() => decodeTextFile(controls)).toThrow(/not text/)
    // UTF-32 has a byte order mark that starts like UTF-16's, followed by NULs.
    expect(() => decodeTextFile(bytesOf([0xff, 0xfe, 0, 0, 0x41, 0, 0, 0]))).toThrow(LiveFormatError)
  })

  it('refuses a UTF-16 file cut in the middle of a character', () => {
    expect(() => decodeTextFile(bytesOf([0xff, 0xfe, 0x41]))).toThrow(expect.objectContaining({ code: 'corrupt' }))
  })

  it('writes Windows-1252 text that gained other characters as UTF-8', () => {
    expect(Array.from(encodeTextFile('é😀', 'windows-1252', 'lf'))).toEqual(Array.from(new TextEncoder().encode('é😀')))
    expect(Array.from(encodeTextFile('é€', 'windows-1252', 'lf'))).toEqual([0xe9, 0x80])
  })
})

describe('textCodec', () => {
  it('keeps the content as one Y.Text with LF line breaks', async () => {
    const { doc } = await imported(bytesOf('a\r\nb\r\n'))
    expect(textOf(doc).toString()).toBe('a\nb\n')
    expect(textCodec.toText(doc)).toBe('a\nb\n')
    expect(textFileFacts(doc)).toEqual({ encoding: 'utf-8', lineEnding: 'crlf' })
  })

  it('creates an empty UTF-8 document', async () => {
    const doc = new Y.Doc()
    const assets = new MemoryLiveAssetStore()
    await textCodec.createEmpty(doc, { name: 'new.py', assets })
    expect(textCodec.toText(doc)).toBe('')
    expect(Array.from(await textCodec.exportFile(doc, { name: 'new.py', assets }))).toEqual([])
  })

  it('writes edits back in the file encoding and line breaks', async () => {
    const { doc, context } = await imported(utf16('one\r\ntwo\r\n', true))
    textOf(doc).insert(4, 'one and a half\n')
    expect(Array.from(await textCodec.exportFile(doc, context))).toEqual(Array.from(utf16('one\r\none and a half\r\ntwo\r\n', true)))
  })

  it('returns a mixed-line-break file unchanged until it is edited', async () => {
    const bytes = bytesOf('a\r\nb\nc\r\n')
    const { doc, context, assets } = await imported(bytes)
    expect(assets.list()).toHaveLength(1)
    expect(Array.from(await textCodec.exportFile(doc, context))).toEqual(Array.from(bytes))
    textOf(doc).insert(0, 'z')
    // Edited: every line break becomes the file's most common one.
    expect(new TextDecoder().decode(await textCodec.exportFile(doc, context))).toBe('za\r\nb\r\nc\r\n')
    textOf(doc).delete(0, 1)
    expect(Array.from(await textCodec.exportFile(doc, context))).toEqual(Array.from(bytes))
  })

  it('refuses files over the size limit', async () => {
    await expect(imported(new Uint8Array(TEXT_MAX_FILE_BYTES + 1).fill(0x41))).rejects.toMatchObject({ code: 'too_large' })
  })

  it('applies a new version as a minimal diff that merges with a concurrent edit', async () => {
    const original = bytesOf('def greet(name):\n    return "hi " + name\n\nprint(greet("you"))\n')
    const { doc, context } = await imported(original)
    const user = new Y.Doc()
    Y.applyUpdate(user, Y.encodeStateAsUpdate(doc))
    // The user edits the last line while an agent's new version arrives.
    textOf(user).insert(textOf(user).toString().indexOf('"you"') + 4, ' all')
    const vector = Y.encodeStateVector(doc)
    const result = await textCodec.applyFile(doc, bytesOf('def greet(name):\n    return "hello " + name\n\nprint(greet("you"))\n'), context, 'agent')
    expect(result).toEqual({ changed: true })
    const agentUpdate = Y.encodeStateAsUpdate(doc, vector)
    // Small: the agent changed one word, not the file.
    expect(agentUpdate.byteLength).toBeLessThan(80)
    Y.applyUpdate(user, agentUpdate)
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(user))
    expect(textCodec.toText(doc)).toBe('def greet(name):\n    return "hello " + name\n\nprint(greet("you all"))\n')
    expect(textCodec.toText(user)).toBe(textCodec.toText(doc))
  })

  it('reports an unchanged file as unchanged without writing anything', async () => {
    const bytes = bytesOf('same\r\n')
    const { doc, context } = await imported(bytes)
    const vector = Y.encodeStateVector(doc)
    expect(await textCodec.applyFile(doc, bytes, context, 'agent')).toEqual({ changed: false })
    expect(Array.from(Y.encodeStateVector(doc))).toEqual(Array.from(vector))
  })

  it('reports a version that only deletes text as a change', async () => {
    const { doc, context } = await imported(bytesOf('keep\ndrop\n'))
    expect(await textCodec.applyFile(doc, bytesOf('keep\n'), context, 'agent')).toEqual({ changed: true })
    expect(textCodec.toText(doc)).toBe('keep\n')
  })

  it('takes a new encoding or line break style from an applied file', async () => {
    const { doc, context } = await imported(bytesOf('a\nb\n'))
    expect(await textCodec.applyFile(doc, bytesOf('a\r\nb\r\n'), context, 'agent')).toEqual({ changed: true })
    expect(textFileFacts(doc).lineEnding).toBe('crlf')
    expect(textCodec.toText(doc)).toBe('a\nb\n')
  })

  it('applies the transaction with the given origin', async () => {
    const { doc, context } = await imported(bytesOf('x'))
    const origins: unknown[] = []
    doc.on('update', (_update: Uint8Array, origin: unknown) => origins.push(origin))
    await textCodec.applyFile(doc, bytesOf('y'), context, 'agent')
    expect(origins).toEqual(['agent'])
  })

  it('converges with two concurrent editors and an agent push (fuzz)', async () => {
    let seed = 7
    const next = () => (seed = (seed * 16_807) % 2_147_483_647) / 2_147_483_647
    for (let round = 0; round < 40; round += 1) {
      const { doc: server, context } = await imported(bytesOf('alpha\nbeta\ngamma\ndelta\n'))
      const left = new Y.Doc()
      const right = new Y.Doc()
      Y.applyUpdate(left, Y.encodeStateAsUpdate(server))
      Y.applyUpdate(right, Y.encodeStateAsUpdate(server))
      for (const replica of [left, right]) {
        for (let edit = 0; edit < 5; edit += 1) {
          const text = textOf(replica)
          const at = Math.floor(next() * (text.length + 1))
          if (next() < 0.5 && at < text.length) text.delete(at, Math.min(3, text.length - at))
          else text.insert(at, next() < 0.3 ? '\n' : 'xy')
        }
      }
      await textCodec.applyFile(server, bytesOf('alpha\nBETA\ngamma\nepsilon\ndelta\n'), context, 'agent')
      for (const [from, to] of [[left, server], [right, server], [server, left], [server, right], [left, right], [right, left]] as const) {
        Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)))
      }
      expect(textCodec.toText(left)).toBe(textCodec.toText(server))
      expect(textCodec.toText(right)).toBe(textCodec.toText(server))
      expect(textCodec.toText(server)).toContain('BETA')
    }
  })
})
