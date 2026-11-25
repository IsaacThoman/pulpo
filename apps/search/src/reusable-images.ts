export const reusableImageLicenses = ['public-domain', 'commercial', 'modification'] as const
export const reusableImageCategories = ['photograph', 'illustration', 'digitized_artwork'] as const

export interface ReusableImageFilters {
  license?: (typeof reusableImageLicenses)[number]
  category?: (typeof reusableImageCategories)[number]
}

const plainWord = /^[\p{L}\p{N}][\p{L}\p{M}\p{N}\p{Pd}]*$/u
const imageMedium = /^(?:drawing|engraving|etching|illustration|lithograph|painting|photo|photograph|portrait|poster|print|sketch|woodcut)s?$/i
const connectingWord = /^(?:a|an|and|for|from|in|of|on|or|the|to|with)$/i

export function shorterReusableImageQuery(query: string): string | undefined {
  const words = query.trim().split(/\s+/u)
  if (words.length < 5 || !words.every(word => plainWord.test(word))) return
  const [subject, medium] = words.slice(-2)
  if (imageMedium.test(medium) && !connectingWord.test(subject)) return `${subject} ${medium}`
}
