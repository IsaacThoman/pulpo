/** Links a click may open: web pages, mail, and phone numbers (never javascript: and the like). */
export const OPENABLE_LINK = /^(https?:|mailto:|tel:)/i

/** "https://www.example.com/docs/" → "example.com/docs". */
export function shortLink(href: string): string {
  return href.replace(/^https?:\/\/(www\.)?/i, '').replace(/^mailto:/i, '').replace(/\/$/, '')
}
