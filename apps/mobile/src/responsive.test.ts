import { describe, expect, it } from 'vitest'
import {
  responsiveHorizontalPadding,
  usesAssistantSideRail,
  usesPersistentSidebar,
  windowSizeClass,
} from './responsive'

describe('responsive window sizing', () => {
  it.each([
    [320, 'compact'],
    [699, 'compact'],
    [700, 'medium'],
    [799, 'medium'],
    [800, 'wide'],
    [1366, 'wide'],
  ] as const)('classifies a %d point window as %s', (width, expected) => {
    expect(windowSizeClass(width)).toBe(expected)
  })

  it('uses persistent navigation only when the navigation and chat can both fit', () => {
    expect(usesPersistentSidebar(744)).toBe(false)
    expect(usesPersistentSidebar(800)).toBe(true)
  })

  it('reserves an assistant logo rail only when the chat has tablet-class width', () => {
    expect(usesAssistantSideRail(390)).toBe(false)
    expect(usesAssistantSideRail(699)).toBe(false)
    expect(usesAssistantSideRail(700)).toBe(true)
    expect(usesAssistantSideRail(744)).toBe(true)
  })

  it('increases gutters without scaling them with the whole display', () => {
    expect(responsiveHorizontalPadding(390)).toBe(18)
    expect(responsiveHorizontalPadding(744)).toBe(24)
    expect(responsiveHorizontalPadding(1024)).toBe(28)
  })
})
