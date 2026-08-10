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

  it('rejects unsupported, malformed, and oversized inputs', async () => {
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).gif().toBuffer()
    await expect(createCatalogIconVariants(gif, 'image/gif')).rejects.toThrow('PNG, JPEG, or WebP')
    await expect(createCatalogIconVariants(new TextEncoder().encode('not an image'), 'image/png')).rejects.toThrow()
    await expect(createCatalogIconVariants(new Uint8Array(CATALOG_ICON_MAX_BYTES + 1), 'image/png')).rejects.toThrow('between 1 byte')
  })
})
