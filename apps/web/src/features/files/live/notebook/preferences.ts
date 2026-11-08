/**
 * The notebook editor's view preferences (line numbers, wrapping, the outline), kept per browser
 * with `useStoredFlag`. They never go into the document: they are how this person reads it, not
 * what it says.
 */
export const NOTEBOOK_PREFERENCES = {
  lineNumbers: 'pulpo:notebook:line-numbers',
  wrap: 'pulpo:notebook:wrap',
  outline: 'pulpo:notebook:outline',
} as const

export { useStoredFlag } from '../stored-preference'
