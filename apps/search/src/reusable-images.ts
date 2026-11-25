export const reusableImageLicenses = ['public-domain', 'commercial', 'modification'] as const
export const reusableImageCategories = ['photograph', 'illustration', 'digitized_artwork'] as const

export interface ReusableImageFilters {
  license?: (typeof reusableImageLicenses)[number]
  category?: (typeof reusableImageCategories)[number]
}
