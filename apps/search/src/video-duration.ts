export const videoDurationOptions = [
  ['any', 'Any duration'],
  ['short', 'Under 5 minutes'],
  ['medium', '5–19 minutes'],
  ['long', '20 minutes or more'],
] as const

export type VideoDuration = (typeof videoDurationOptions)[number][0]

export function videoDurationBucket(duration: string | undefined): Exclude<VideoDuration, 'any'> | undefined {
  if (!duration || !/^\d{1,4}:[0-5]\d(?::[0-5]\d)?$/.test(duration)) return
  const seconds = duration.split(':').reduce((total, part) => total * 60 + Number(part), 0)
  if (seconds > 0) return seconds < 5 * 60 ? 'short' : seconds < 20 * 60 ? 'medium' : 'long'
}
