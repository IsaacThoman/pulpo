/**
 * Which section each slide is in. A file lists sections as consecutive runs in section order, so
 * a slide whose own section comes before the current one (moved there, or two people moved slides
 * at once) is shown and saved in the section it sits in, as are slides with no known section.
 */
export function slideSections(sectionKeys: readonly string[], slides: readonly { section?: string }[]): (string | undefined)[] {
  if (!sectionKeys.length) return slides.map(() => undefined)
  const rank = new Map(sectionKeys.map((key, index) => [key, index]))
  let current = 0
  return slides.map((slide) => {
    const own = slide.section !== undefined ? rank.get(slide.section) : undefined
    if (own !== undefined && own > current) current = own
    return sectionKeys[current]
  })
}
