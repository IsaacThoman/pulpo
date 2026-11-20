import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { MultipartJpegParser, ScreenControl, frameId } from './desktop-screen.js'

const part = (data: Buffer, header = 'Content-Length') => Buffer.concat([Buffer.from(`--ffmpeg\r\nContent-type: image/jpeg\r\n${header}: ${data.length}\r\n\r\n`), data, Buffer.from('\r\n')])

describe('the mpjpeg parser', () => {
  const pictures = [Buffer.from([0xff, 0xd8, 0x0d, 0x0a, 0x0d, 0x0a, 0xff, 0xd9]), Buffer.alloc(3_000, 9), Buffer.from('third')]

  it('reads whole parts, several to a chunk', () => {
    const parser = new MultipartJpegParser()
    expect(parser.push(Buffer.concat(pictures.map((picture) => part(picture))))).toEqual(pictures)
  })

  it('reads parts split anywhere across chunks, including a picture holding blank lines', () => {
    const stream = Buffer.concat(pictures.map((picture) => part(picture)))
    for (const size of [1, 2, 7, 64, 1_000]) {
      const parser = new MultipartJpegParser()
      const frames: Buffer[] = []
      for (let at = 0; at < stream.length; at += size) frames.push(...parser.push(stream.subarray(at, at + size)))
      expect(frames).toEqual(pictures)
    }
  })

  it('takes Content-Length in any letter case', () => {
    expect(new MultipartJpegParser().push(Buffer.concat([part(pictures[0]!, 'content-length'), part(pictures[2]!, 'CONTENT-LENGTH')]))).toEqual([pictures[0], pictures[2]])
  })

  it('refuses a part it cannot measure', () => {
    expect(() => new MultipartJpegParser().push(Buffer.from('--ffmpeg\r\nContent-type: image/jpeg\r\n\r\nabc'))).toThrow('The screen stream sent a part without a Content-Length.')
    expect(() => new MultipartJpegParser().push(Buffer.alloc(5_000, 0x41))).toThrow('The screen stream sent a part without the end of its headers.')
  })

  it('names a frame by the start of its SHA-256', () => {
    expect(frameId(pictures[2]!)).toBe(createHash('sha256').update('third').digest('hex').slice(0, 32))
  })
})

describe('screen control', () => {
  it('is held until it lapses, renewed by taking it again, and given back', () => {
    let now = 0
    const control = new ScreenControl(20_000, () => now)
    expect(control.held).toBe(false)
    control.take()
    now = 19_999
    expect(control.held).toBe(true)
    control.take()
    now = 39_000
    expect(control.held).toBe(true)
    now = 40_000
    expect(control.held).toBe(false)
    control.take()
    control.release()
    expect(control.held).toBe(false)
  })
})
