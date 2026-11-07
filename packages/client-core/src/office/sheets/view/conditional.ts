import { RangeLookup } from '../range-lookup.js'
import { type CellRange } from '../address.js'
import { serialToParts } from '../dates.js'
import type { CfValue, ConditionalFormat, ConditionalRule, SheetColor } from '../model/schema.js'
import type { SheetModel } from '../model/workbook.js'
import type { DifferentialStyle, Stylesheet } from '../styles/stylesheet.js'
import { forEachPopulatedValue, isErrorValue, type CellValue, type SheetValues } from '../values.js'
import { cssColor, type ThemeColors } from './colors.js'
import { evaluateRuleFormula } from './rule-formula.js'
export { literalValue } from './rule-formula.js'

/** What conditional formats change about one cell. */
export interface ConditionalOverlay {
  style?: DifferentialStyle
  /** Background from a color scale. */
  scaleColor?: string
  dataBar?: { fraction: number; color: string; negative: boolean; showValue: boolean; axis?: number }
  icon?: { set: string; index: number; showValue: boolean }
}

interface Block {
  ranges: CellRange[]
  rules: ConditionalRule[]
  /** Top-left of the first range: relative formulas are written for it. */
  origin: { row: number; col: number }
  stats?: BlockStats
}

interface BlockStats {
  numbers: number[]
  sorted: number[]
  counts: Map<string, number>
  mean: number
  stdDev: number
}

function numeric(value: CellValue): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function valueKey(value: CellValue): string {
  if (value === null) return ''
  if (isErrorValue(value)) return `#${value.e}`
  return typeof value === 'string' ? `s:${value.toLowerCase()}` : `${typeof value}:${String(value)}`
}

function truthy(value: CellValue | CellValue[][] | undefined): boolean {
  const scalar = Array.isArray(value) ? value[0]?.[0] : value
  if (typeof scalar === 'boolean') return scalar
  if (typeof scalar === 'number') return scalar !== 0
  if (typeof scalar === 'string') return scalar.toUpperCase() === 'TRUE'
  return false
}

function scalarOf(value: CellValue | CellValue[][] | undefined): CellValue {
  return Array.isArray(value) ? (value[0]?.[0] ?? null) : (value ?? null)
}

/** Compares like Excel: numbers with numbers, text case-insensitively; text sorts after numbers. */
function compare(a: CellValue, b: CellValue): number {
  const rank = (value: CellValue) => (typeof value === 'number' || value === null ? 0 : typeof value === 'string' ? 1 : typeof value === 'boolean' ? 2 : 3)
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb
  if (ra === 0) return (a as number | null ?? 0) - (b as number | null ?? 0)
  if (ra === 1) return (a as string).toLowerCase().localeCompare((b as string).toLowerCase())
  return Number(a) - Number(b)
}

/** Mixes two hex colors. */
function mix(a: string, b: string, t: number): string {
  const channel = (hex: string, index: number) => parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16)
  const parts = [0, 1, 2].map((index) => Math.round(channel(a, index) + (channel(b, index) - channel(a, index)) * t))
  return `#${parts.map((part) => part.toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

export class ConditionalFormatter {
  private blocks: Block[] | undefined
  private lookup: RangeLookup<Block> | undefined
  private cache = new Map<string, ConditionalOverlay | null>()

  constructor(
    private readonly sheet: SheetModel,
    private readonly values: SheetValues,
    private readonly styles: Stylesheet,
    private readonly theme: ThemeColors,
    private readonly now: () => number = () => Date.now(),
  ) {}

  invalidate(): void {
    this.blocks = undefined
    this.lookup = undefined
    this.cache.clear()
  }

  private getBlocks(): Block[] {
    if (this.blocks) return this.blocks
    const blocks: Block[] = []
    for (const raw of this.sheet.cf.values()) {
      const format = raw as ConditionalFormat
      const ranges = format.ranges.map((ids) => this.sheet.resolveRange(ids)).filter((range): range is CellRange => !!range)
      if (!ranges.length) continue
      blocks.push({ ranges, rules: [...format.rules].sort((a, b) => a.priority - b.priority), origin: { row: ranges[0]!.top, col: ranges[0]!.left } })
    }
    this.blocks = blocks
    return blocks
  }

  overlay(row: number, col: number): ConditionalOverlay | undefined {
    const key = `${row},${col}`
    const cached = this.cache.get(key)
    if (cached !== undefined) return cached ?? undefined
    const matches: { priority: number; rule: ConditionalRule; block: Block }[] = []
    this.lookup ??= new RangeLookup(this.getBlocks(), (block) => block.ranges)
    for (const block of this.lookup.overlapping({ top: row, bottom: row, left: col, right: col })) {
      for (const rule of block.rules) matches.push({ priority: rule.priority, rule, block })
    }
    if (!matches.length) {
      this.cache.set(key, null)
      return undefined
    }
    matches.sort((a, b) => a.priority - b.priority)
    const value = this.values.get(this.sheet, row, col)
    const overlay: ConditionalOverlay = {}
    let any = false
    for (const { rule, block } of matches) {
      const applied = this.apply(rule, block, row, col, value, overlay)
      any ||= applied
      if (applied && rule.stopIfTrue) break
    }
    const result = any ? overlay : null
    this.cache.set(key, result)
    return result ?? undefined
  }

  private stats(block: Block): BlockStats {
    if (block.stats) return block.stats
    const numbers: number[] = []
    const counts = new Map<string, number>()
    forEachPopulatedValue(this.sheet, this.values, block.ranges, (_row, _col, value) => {
      const n = numeric(value)
      if (n !== undefined) numbers.push(n)
      const key = valueKey(value)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
    const sorted = [...numbers].sort((a, b) => a - b)
    const mean = numbers.length ? numbers.reduce((sum, n) => sum + n, 0) / numbers.length : 0
    const variance = numbers.length > 1 ? numbers.reduce((sum, n) => sum + (n - mean) ** 2, 0) / numbers.length : 0
    block.stats = { numbers, sorted, counts, mean, stdDev: Math.sqrt(variance) }
    return block.stats
  }

  /** Evaluates a rule formula for a cell: written for the block's top-left, moved to the cell. */
  private formula(formula: string, block: Block, row: number, col: number): CellValue | CellValue[][] | undefined {
    return evaluateRuleFormula(this.sheet, this.values, formula, { top: block.origin.row, left: block.origin.col }, row, col)
  }

  private threshold(value: CfValue, block: Block, row: number, col: number): number | undefined {
    const { sorted } = this.stats(block)
    if (!sorted.length) return undefined
    const min = sorted[0]!
    const max = sorted[sorted.length - 1]!
    switch (value.type) {
      case 'min':
      case 'autoMin':
        return value.type === 'autoMin' ? Math.min(0, min) : min
      case 'max':
      case 'autoMax':
        return value.type === 'autoMax' ? Math.max(0, max) : max
      case 'num':
        return Number(value.value)
      case 'percent':
        return min + ((max - min) * Number(value.value)) / 100
      case 'percentile': {
        const position = (Number(value.value) / 100) * (sorted.length - 1)
        const low = Math.floor(position)
        const high = Math.ceil(position)
        return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low)
      }
      case 'formula': {
        const result = numeric(scalarOf(value.value === undefined ? undefined : this.formula(value.value, block, row, col)))
        return result
      }
    }
    return undefined
  }

  private apply(rule: ConditionalRule, block: Block, row: number, col: number, value: CellValue, overlay: ConditionalOverlay): boolean {
    const style = (matched: boolean) => {
      if (!matched) return false
      const dxf = rule.dxfId !== undefined ? this.styles.dxf(rule.dxfId) : undefined
      // Higher-priority rules already set what they set; lower ones only fill gaps.
      if (dxf) overlay.style = mergeDxf(overlay.style, dxf)
      return true
    }
    const text = value === null ? '' : isErrorValue(value) ? value.e : String(value)
    switch (rule.type) {
      case 'cellIs': {
        if (value === null && rule.operator !== 'equal' && rule.operator !== 'notEqual') return false
        const a = scalarOf(rule.formulas?.[0] !== undefined ? this.formula(rule.formulas[0], block, row, col) : undefined)
        const b = scalarOf(rule.formulas?.[1] !== undefined ? this.formula(rule.formulas[1], block, row, col) : undefined)
        if (isErrorValue(value) || isErrorValue(a) || isErrorValue(b)) return false
        const c = compare(value, a)
        const low = compare(a, b) <= 0 ? a : b
        const high = compare(a, b) <= 0 ? b : a
        switch (rule.operator) {
          case 'equal':
            return style(c === 0)
          case 'notEqual':
            return style(c !== 0)
          case 'greaterThan':
            return style(c > 0)
          case 'lessThan':
            return style(c < 0)
          case 'greaterThanOrEqual':
            return style(c >= 0)
          case 'lessThanOrEqual':
            return style(c <= 0)
          case 'between':
            return style(compare(value, low) >= 0 && compare(value, high) <= 0)
          case 'notBetween':
            return style(compare(value, low) < 0 || compare(value, high) > 0)
        }
        return false
      }
      case 'expression':
        return style(rule.formulas?.[0] !== undefined && truthy(this.formula(rule.formulas[0], block, row, col)))
      case 'containsText':
        return style(text.toLowerCase().includes((rule.text ?? '').toLowerCase()))
      case 'notContainsText':
        return style(!text.toLowerCase().includes((rule.text ?? '').toLowerCase()))
      case 'beginsWith':
        return style(text.toLowerCase().startsWith((rule.text ?? '').toLowerCase()))
      case 'endsWith':
        return style(text.toLowerCase().endsWith((rule.text ?? '').toLowerCase()))
      case 'containsBlanks':
        return style(text.trim() === '')
      case 'notContainsBlanks':
        return style(text.trim() !== '')
      case 'containsErrors':
        return style(isErrorValue(value))
      case 'notContainsErrors':
        return style(!isErrorValue(value))
      case 'duplicateValues':
      case 'uniqueValues': {
        if (value === null) return false
        const count = this.stats(block).counts.get(valueKey(value)) ?? 0
        return style(rule.type === 'duplicateValues' ? count > 1 : count === 1)
      }
      case 'top10': {
        const n = numeric(value)
        if (n === undefined) return false
        const { sorted } = this.stats(block)
        const rank = rule.percent ? Math.max(1, Math.floor((sorted.length * (rule.rank ?? 10)) / 100)) : (rule.rank ?? 10)
        if (rule.bottom) return style(n <= (sorted[Math.min(rank, sorted.length) - 1] ?? -Infinity))
        return style(n >= (sorted[Math.max(0, sorted.length - rank)] ?? Infinity))
      }
      case 'aboveAverage': {
        const n = numeric(value)
        if (n === undefined) return false
        const { mean, stdDev } = this.stats(block)
        const above = rule.aboveAverage !== false
        const bound = mean + (rule.stdDev ? (above ? 1 : -1) * rule.stdDev * stdDev : 0)
        if (above) return style(rule.equalAverage ? n >= bound : n > bound)
        return style(rule.equalAverage ? n <= bound : n < bound)
      }
      case 'timePeriod': {
        const n = numeric(value)
        return n !== undefined && style(inTimePeriod(n, rule.timePeriod ?? 'today', this.now()))
      }
      case 'colorScale': {
        const n = numeric(value)
        const scale = rule.colorScale
        if (n === undefined || !scale || overlay.scaleColor) return false
        const stops = scale.values.map((entry) => this.threshold(entry, block, row, col))
        const colors = scale.colors.map((color) => cssColor(color, this.theme) ?? '#FFFFFF')
        if (stops.some((stop) => stop === undefined)) return false
        overlay.scaleColor = interpolate(n, stops as number[], colors)
        return true
      }
      case 'dataBar': {
        const n = numeric(value)
        const bar = rule.dataBar
        if (n === undefined || !bar || overlay.dataBar) return false
        const low = this.threshold(bar.values[0] ?? { type: 'min' }, block, row, col) ?? 0
        const high = this.threshold(bar.values[1] ?? { type: 'max' }, block, row, col) ?? 0
        const minLength = (bar.minLength ?? 10) / 100
        const maxLength = (bar.maxLength ?? 90) / 100
        const span = high - low
        const fraction = span <= 0 ? maxLength : minLength + (maxLength - minLength) * Math.min(1, Math.max(0, (n - low) / span))
        overlay.dataBar = { fraction, color: cssColor(bar.color, this.theme) ?? '#638EC6', negative: n < 0, showValue: bar.showValue !== false }
        return true
      }
      case 'iconSet': {
        const n = numeric(value)
        const icons = rule.iconSet
        if (n === undefined || !icons || overlay.icon) return false
        let index = 0
        icons.values.forEach((entry, position) => {
          if (position === 0) return
          const stop = this.threshold(entry.type === 'percent' || entry.type === 'percentile' || entry.type === 'num' || entry.type === 'formula' ? entry : { type: 'percent', value: '0' }, block, row, col)
          if (stop !== undefined && (entry.gte === false ? n > stop : n >= stop)) index = position
        })
        if (icons.reverse) index = icons.values.length - 1 - index
        overlay.icon = { set: icons.set, index, showValue: icons.showValue !== false }
        return true
      }
    }
    return false
  }
}

function mergeDxf(current: DifferentialStyle | undefined, next: DifferentialStyle): DifferentialStyle {
  if (!current) return next
  return {
    font: { ...next.font, ...current.font },
    ...(current.fill !== undefined || next.fill !== undefined ? { fill: current.fill !== undefined ? current.fill : next.fill } : {}),
    border: { ...next.border, ...current.border },
    ...(current.numFmt ?? next.numFmt ? { numFmt: current.numFmt ?? next.numFmt } : {}),
  }
}

function interpolate(n: number, stops: number[], colors: string[]): string {
  if (n <= stops[0]!) return colors[0]!
  for (let index = 1; index < stops.length; index++) {
    if (n <= stops[index]!) {
      const span = stops[index]! - stops[index - 1]!
      return mix(colors[index - 1]!, colors[index]!, span <= 0 ? 1 : (n - stops[index - 1]!) / span)
    }
  }
  return colors[colors.length - 1]!
}

function inTimePeriod(serial: number, period: string, nowMs: number): boolean {
  const day = Math.floor(serial)
  const now = new Date(nowMs)
  const today = Math.floor((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(1899, 11, 30)) / 86_400_000)
  const parts = serialToParts(day)
  const todayParts = serialToParts(today)
  if (!parts || !todayParts) return false
  const weekStart = today - todayParts.weekday
  const monthIndex = (p: { year: number; month: number }) => p.year * 12 + p.month - 1
  switch (period) {
    case 'today':
      return day === today
    case 'yesterday':
      return day === today - 1
    case 'tomorrow':
      return day === today + 1
    case 'last7Days':
      return day > today - 7 && day <= today
    case 'thisWeek':
      return day >= weekStart && day < weekStart + 7
    case 'lastWeek':
      return day >= weekStart - 7 && day < weekStart
    case 'nextWeek':
      return day >= weekStart + 7 && day < weekStart + 14
    case 'thisMonth':
      return monthIndex(parts) === monthIndex(todayParts)
    case 'lastMonth':
      return monthIndex(parts) === monthIndex(todayParts) - 1
    case 'nextMonth':
      return monthIndex(parts) === monthIndex(todayParts) + 1
  }
  return false
}

export type { SheetColor }
