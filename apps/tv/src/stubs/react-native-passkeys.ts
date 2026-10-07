export function isSupported(): boolean { return false }
const unavailable = () => Promise.reject(new Error('Passkeys are not available on Apple TV'))
export const create = unavailable
export const get = unavailable
