export const galleryGap = 8

export interface ImageTileSize {
  width: number
  height: number
  rowStart: boolean
}

export function sizeImageTiles(aspects: readonly (number | undefined)[], width: number): ImageTileSize[] {
  if (width <= galleryGap * 2) return []
  const phone = width < 480
  const targetHeight = phone ? 148 : width < 900 ? 144 : 166
  const ratios = aspects.map(aspect => {
    const ratio = aspect && Number.isFinite(aspect) && aspect > 0 ? aspect : 4 / 3
    return Math.min(phone ? 2.4 : 3, Math.max(phone ? .72 : .48, ratio))
  })
  const tiles: ImageTileSize[] = []

  function fittedHeight(count: number, ratioSum: number) {
    return (width - (count - 1) * galleryGap) / ratioSum
  }

  for (let start = 0; start < ratios.length;) {
    let end = Math.min(start + 2, ratios.length)
    let ratioSum = ratios.slice(start, end).reduce((sum, ratio) => sum + ratio, 0)
    if (!phone) {
      while (end < ratios.length && fittedHeight(end - start, ratioSum) > targetHeight) {
        const current = fittedHeight(end - start, ratioSum)
        const next = fittedHeight(end - start + 1, ratioSum + ratios[end])
        if (Math.abs(next - targetHeight) > current - targetHeight) break
        ratioSum += ratios[end]
        end += 1
      }
    }

    const count = end - start
    const fit = fittedHeight(count, ratioSum)
    const partialRow = end === ratios.length && fit > targetHeight && (!phone || count === 1)
    const height = Math.max(1, Math.round(Math.min(fit, partialRow ? targetHeight : phone ? 188 : 220)))
    const rowWidth = partialRow ? Math.round(ratioSum * height) : width - (count - 1) * galleryGap
    let offset = 0
    let portion = 0
    for (let index = start; index < end; index += 1) {
      portion += ratios[index]
      const boundary = Math.round(rowWidth * portion / ratioSum)
      tiles.push({ width: boundary - offset, height, rowStart: index === start })
      offset = boundary
    }
    start = end
  }
  return tiles
}
