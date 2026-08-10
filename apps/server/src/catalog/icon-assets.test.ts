import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  CATALOG_ICON_EDGE_PX,
  CATALOG_ICON_MAX_BYTES,
  createCatalogIconVariants,
} from './icon-assets.js'

describe('catalog icon image processing', () => {
  it('normalizes artwork and creates light and dark monochrome silhouettes', async () => {
    const source = await sharp({
      create: { width: 120, height: 60, channels: 4, background: { r: 30, g: 90, b: 220, alpha: 1 } },
    }).png().withMetadata({ orientation: 1 }).toBuffer()

    const variants = await createCatalogIconVariants(source, 'image/png')
    for (const bytes of [variants.original, variants.monochromeLight, variants.monochromeDark]) {
      const metadata = await sharp(bytes).metadata()
      expect(metadata).toMatchObject({ format: 'png', width: CATALOG_ICON_EDGE_PX, height: CATALOG_ICON_EDGE_PX })
      expect(metadata.exif).toBeUndefined()
    }

    const center = (await Promise.all([
      sharp(variants.original).ensureAlpha().raw().toBuffer(),
      sharp(variants.monochromeLight).ensureAlpha().raw().toBuffer(),
      sharp(variants.monochromeDark).ensureAlpha().raw().toBuffer(),
    ])).map((pixels) => [...pixels.subarray(((128 * 256) + 128) * 4, ((128 * 256) + 128) * 4 + 4)])
    expect(center[0]).toEqual([30, 90, 220, 255])
    expect(center[1]).toEqual([0, 0, 0, 255])
    expect(center[2]).toEqual([255, 255, 255, 255])
  })

  it('rasterizes safe SVG artwork into canonical PNG variants', async () => {
    const source = new TextEncoder().encode(`
      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="16" viewBox="0 0 32 16">
        <defs><linearGradient id="paint"><stop stop-color="#1e5adc" /></linearGradient></defs>
        <rect width="32" height="16" fill="url(#paint)" />
      </svg>
    `)
    const variants = await createCatalogIconVariants(source, 'image/svg+xml; charset=utf-8')

    for (const bytes of [variants.original, variants.monochromeLight, variants.monochromeDark]) {
      expect(await sharp(bytes).metadata()).toMatchObject({
        format: 'png', width: CATALOG_ICON_EDGE_PX, height: CATALOG_ICON_EDGE_PX,
      })
    }
    const pixels = await sharp(variants.original).ensureAlpha().raw().toBuffer()
    expect([...pixels.subarray(((128 * 256) + 128) * 4, ((128 * 256) + 128) * 4 + 4)]).toEqual([30, 90, 220, 255])
  })

  it('rejects SVG active content and non-local resources before rendering', async () => {
    const svg = (content: string) => new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg">${content}</svg>`)
    await expect(createCatalogIconVariants(svg('<script>alert(1)</script>'), 'image/svg+xml')).rejects.toThrow('active or embedded content')
    await expect(createCatalogIconVariants(svg('<image href="data:image/png;base64,AAAA" />'), 'image/svg+xml')).rejects.toThrow('active or embedded content')
    await expect(createCatalogIconVariants(svg('<use href="https://example.com/icon.svg#mark" />'), 'image/svg+xml')).rejects.toThrow('same document')
    await expect(createCatalogIconVariants(svg('<path onclick="alert(1)" />'), 'image/svg+xml')).rejects.toThrow('scripts or imported styles')
  })

  it('rejects unsupported, malformed, and oversized inputs', async () => {
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).gif().toBuffer()
    await expect(createCatalogIconVariants(gif, 'image/gif')).rejects.toThrow('PNG, JPEG, WebP, or SVG')
    await expect(createCatalogIconVariants(new TextEncoder().encode('not an image'), 'image/png')).rejects.toThrow()
    await expect(createCatalogIconVariants(new Uint8Array(CATALOG_ICON_MAX_BYTES + 1), 'image/png')).rejects.toThrow('between 1 byte')
  })
})
