/** Typed addresses often leave out the scheme; pages are only fetched over HTTPS. */
export function normalizeImportUrl(value: string): string {
  const trimmed = value.trim()
  return !trimmed || /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}
