// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { presentationCodec } from '../codec.js'
import { memoryAssets } from '../testing/assets.js'
import { PresentationController } from './controller.js'
import { printSlides } from './present.js'

const controllers: PresentationController[] = []
const print = vi.fn()
let decode = vi.fn<() => Promise<void>>()

beforeEach(() => {
  vi.useFakeTimers()
  print.mockClear()
  decode = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('Image', class { src = ''; decode = () => decode() })
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:test/image', revokeObjectURL: vi.fn() })
  const append = document.body.append.bind(document.body)
  vi.spyOn(document.body, 'append').mockImplementation((...nodes) => {
    append(...nodes)
    for (const node of nodes) if (node instanceof HTMLIFrameElement) {
      node.contentWindow!.print = print
      node.contentWindow!.focus = vi.fn()
    }
  })
})

afterEach(() => {
  for (const controller of controllers.splice(0)) { controller.destroy(); controller.doc.destroy() }
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function coldController(get?: (hash: string) => Promise<Uint8Array>) {
  const assets = memoryAssets()
  const doc = new Y.Doc()
  await presentationCodec.importFile(doc, new Uint8Array(readFileSync('fixtures/presentation/generated/pictures.pptx')), { name: 'deck.pptx', assets })
  const controller = new PresentationController({ doc, assets: get ? { ...assets, get } : assets, readOnly: true, user: { name: 'Print test', color: '#123456' } })
  controllers.push(controller)
  return { controller, assets }
}

describe('presentation printing', () => {
  it('loads unviewed slides before generating pages, then waits for image decoding', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { controller, assets } = await coldController(async (hash) => { await gate; return assets.get(hash) })
    let decoded!: () => void
    decode.mockReturnValue(new Promise<void>((resolve) => { decoded = resolve }))
    const printing = Promise.resolve(printSlides(controller))
    expect(document.querySelector('iframe')).toBeNull()
    release()
    await vi.advanceTimersByTimeAsync(0)
    const frame = document.querySelector('iframe')!
    expect(frame.contentDocument!.querySelectorAll('.pp-print-page')).toHaveLength(controller.slideKeys().length)
    expect(frame.contentDocument!.querySelectorAll('image[href^="blob:"]').length).toBeGreaterThan(0)
    expect(decode).toHaveBeenCalled()
    expect(print).not.toHaveBeenCalled()
    decoded()
    await printing
    expect(print).toHaveBeenCalledOnce()
    frame.contentWindow!.dispatchEvent(new Event('afterprint'))
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('rejects failed asset loads without opening a partial print document', async () => {
    const { controller } = await coldController(async () => { throw new Error('Offline') })
    await expect(Promise.resolve(printSlides(controller))).rejects.toThrow()
    expect(print).not.toHaveBeenCalled()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('times out and never prints after a late asset response', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { controller, assets } = await coldController(async (hash) => { await gate; return assets.get(hash) })
    const result = Promise.resolve(printSlides(controller, { timeoutMs: 50 })).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(50)
    expect(await result).toBeInstanceOf(Error)
    release()
    await vi.advanceTimersByTimeAsync(1000)
    expect(print).not.toHaveBeenCalled()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('rejects image decoding errors and cleans up the frame', async () => {
    const { controller } = await coldController()
    decode.mockRejectedValue(new Error('Invalid image'))
    await expect(Promise.resolve(printSlides(controller))).rejects.toThrow()
    expect(print).not.toHaveBeenCalled()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('can retry an asset download that failed during the previous print attempt', async () => {
    let fail = true
    const { controller, assets } = await coldController(async (hash) => {
      if (fail) throw new Error('Offline')
      return assets.get(hash)
    })
    await expect(printSlides(controller)).rejects.toThrow()
    fail = false
    await printSlides(controller)
    expect(print).toHaveBeenCalledOnce()
  })
})
