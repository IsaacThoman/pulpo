import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_SIDE_RAIL_EXTRA_WIDTH,
  CHAT_CONTENT_MAX,
  responsiveHorizontalPadding,
  transcriptColumnWidth,
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

  it('reserves an assistant logo rail only after spare width opens beyond the transcript cap', () => {
    expect(usesAssistantSideRail(390)).toBe(false)
    expect(usesAssistantSideRail(CHAT_CONTENT_MAX)).toBe(false)
    expect(usesAssistantSideRail(CHAT_CONTENT_MAX + ASSISTANT_SIDE_RAIL_EXTRA_WIDTH - 1)).toBe(false)
    expect(usesAssistantSideRail(CHAT_CONTENT_MAX + ASSISTANT_SIDE_RAIL_EXTRA_WIDTH)).toBe(true)
  })

  it('increases gutters without scaling them with the whole display', () => {
    expect(responsiveHorizontalPadding(390)).toBe(18)
    expect(responsiveHorizontalPadding(744)).toBe(24)
    expect(responsiveHorizontalPadding(1024)).toBe(28)
  })

  it('caps the transcript column and shrinks it with the live pane', () => {
    expect(transcriptColumnWidth(1200)).toBe(CHAT_CONTENT_MAX)
    expect(transcriptColumnWidth(500)).toBe(500 - 18 * 2)
    expect(transcriptColumnWidth(724, 28)).toBe(724 - 56)
  })
})
