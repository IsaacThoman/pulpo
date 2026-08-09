import { describe, expect, it } from 'vitest'
import { CHAT_PRESET_ICON_NAMES } from '@pulpo/contracts'
import dynamicIconImports from 'lucide-react/dynamicIconImports.mjs'
import {
  filterPresetIconOptions,
  formatPresetIconLabel,
  POPULAR_PRESET_ICON_NAMES,
  PRESET_ICON_SEARCH_LIMIT,
} from './preset-icon-options'

describe('preset icon options', () => {
  it('stays synchronized with the pinned Lucide canonical icon set', () => {
    const canonicalLucideNames = Object.entries(dynamicIconImports)
      .filter(([name, loadIcon]) => String(loadIcon).includes(`./icons/${name}.mjs`))
      .map(([name]) => name)
      .sort((left, right) => left.localeCompare(right))
    expect(CHAT_PRESET_ICON_NAMES).toEqual(canonicalLucideNames)
  })

  it('shows popular icons until a search is entered', () => {
    expect(filterPresetIconOptions('')).toHaveLength(POPULAR_PRESET_ICON_NAMES.length)
    expect(filterPresetIconOptions('')[0]).toEqual({ id: 'brain', label: 'Brain' })
  })

  it('searches canonical names case-insensitively and limits results', () => {
    const camera = filterPresetIconOptions('CAMERA')
    expect(camera.some((option) => option.id === 'camera')).toBe(true)
    expect(filterPresetIconOptions('a').length).toBe(PRESET_ICON_SEARCH_LIMIT)
  })

  it('formats kebab-case names for display', () => {
    expect(formatPresetIconLabel('chart-no-axes-column')).toBe('Chart No Axes Column')
  })
})
