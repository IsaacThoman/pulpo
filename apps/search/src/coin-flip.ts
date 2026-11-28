export type CoinFace = 'heads' | 'tails'

/** Fair faces from the browser's cryptographic random source. */
export function randomFaces(count: number): CoinFace[] {
  return [...crypto.getRandomValues(new Uint8Array(count))].map(byte => byte & 1 ? 'tails' : 'heads')
}
