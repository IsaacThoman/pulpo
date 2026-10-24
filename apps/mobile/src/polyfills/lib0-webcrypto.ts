import { getRandomValues as cryptoRandomValues } from 'expo-crypto'

/**
 * `lib0/webcrypto` for React Native. lib0 (Yjs's utility library) resolves this module to
 * `isomorphic-webcrypto` under React Native, which Pulpo does not ship; Metro points it here
 * instead (see metro.config.js). Yjs only needs random values, for document client ids.
 */
export function getRandomValues<T extends ArrayBufferView>(array: T): T {
  return cryptoRandomValues(array as unknown as Uint8Array) as unknown as T
}

/** Yjs never uses SubtleCrypto; lib0's own users of it are not bundled. */
export const subtle = undefined
