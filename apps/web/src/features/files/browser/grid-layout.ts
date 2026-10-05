import type { FileGridPosition } from '@pulpo/contracts'

/** One grid cell: a tile plus the gap around it. Positions are a tile's top-left corner. */
export const GRID_CELL = { width: 136, height: 128 } as const

interface Cell { col: number; row: number }

const cellKey = (cell: Cell) => `${cell.col}:${cell.row}`

export function cellOf(position: FileGridPosition): Cell {
  return { col: Math.max(0, Math.round(position.x / GRID_CELL.width)), row: Math.max(0, Math.round(position.y / GRID_CELL.height)) }
}

function cellPosition(cell: Cell): FileGridPosition {
  return { x: cell.col * GRID_CELL.width, y: cell.row * GRID_CELL.height }
}

/** The free cell nearest `cell`, searching outward ring by ring (rows and columns start at 0). */
export function nearestFreeCell(cell: Cell, occupied: ReadonlySet<string>): Cell {
  if (!occupied.has(cellKey(cell))) return cell
  for (let radius = 1; radius < 10_000; radius += 1) {
    let best: Cell | null = null
    let bestDistance = Infinity
    for (let row = cell.row - radius; row <= cell.row + radius; row += 1) {
      for (let col = cell.col - radius; col <= cell.col + radius; col += 1) {
        if (row < 0 || col < 0 || (Math.abs(row - cell.row) !== radius && Math.abs(col - cell.col) !== radius)) continue
        if (occupied.has(cellKey({ col, row }))) continue
        const distance = (col - cell.col) ** 2 + (row - cell.row) ** 2
        if (distance < bestDistance) { best = { col, row }; bestDistance = distance }
      }
    }
    if (best) return best
  }
  return cell
}

/**
 * Where every item sits. Saved places are kept (snapped to free cells when snapping); items
 * without one fill the first free cells, row by row, `columns` wide.
 */
export function arrangeGrid(
  ids: readonly string[],
  saved: Readonly<Record<string, FileGridPosition>>,
  options: { columns: number; snap: boolean },
): Map<string, FileGridPosition> {
  const positions = new Map<string, FileGridPosition>()
  const occupied = new Set<string>()
  for (const id of ids) {
    const place = saved[id]
    if (!place) continue
    if (options.snap) {
      const cell = nearestFreeCell(cellOf(place), occupied)
      occupied.add(cellKey(cell))
      positions.set(id, cellPosition(cell))
    } else {
      occupied.add(cellKey(cellOf(place)))
      positions.set(id, { x: place.x, y: place.y })
    }
  }
  const columns = Math.max(1, options.columns)
  let next = 0
  for (const id of ids) {
    if (positions.has(id)) continue
    let cell: Cell
    do {
      cell = { col: next % columns, row: Math.floor(next / columns) }
      next += 1
    } while (occupied.has(cellKey(cell)))
    occupied.add(cellKey(cell))
    positions.set(id, cellPosition(cell))
  }
  return positions
}

/**
 * Moves items by a drag offset, keeping their arrangement. With snapping each lands in the free
 * cell nearest where it was dropped; without, it lands exactly there (never above or left of 0).
 */
export function moveInGrid(
  positions: ReadonlyMap<string, FileGridPosition>,
  movedIds: readonly string[],
  delta: { x: number; y: number },
  snap: boolean,
): Map<string, FileGridPosition> {
  const moved = new Set(movedIds)
  const next = new Map(positions)
  const occupied = new Set([...positions].filter(([id]) => !moved.has(id)).map(([, place]) => cellKey(cellOf(place))))
  for (const id of movedIds) {
    const place = positions.get(id)
    if (!place) continue
    const target = { x: Math.max(0, Math.round(place.x + delta.x)), y: Math.max(0, Math.round(place.y + delta.y)) }
    if (!snap) {
      next.set(id, target)
      continue
    }
    const cell = nearestFreeCell(cellOf(target), occupied)
    occupied.add(cellKey(cell))
    next.set(id, cellPosition(cell))
  }
  return next
}

/** Items in reading order (top to bottom, then left to right), for keyboard navigation. */
export function readingOrder(positions: ReadonlyMap<string, FileGridPosition>): string[] {
  return [...positions].sort(([, a], [, b]) => {
    const rowA = Math.round(a.y / GRID_CELL.height), rowB = Math.round(b.y / GRID_CELL.height)
    return rowA - rowB || a.x - b.x
  }).map(([id]) => id)
}
