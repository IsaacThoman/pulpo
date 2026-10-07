const unavailable = () => Promise.reject(new Error('A web browser is not available on Apple TV'))
export const openAuthSessionAsync = unavailable
export const openBrowserAsync = unavailable
export function maybeCompleteAuthSession() { return { type: 'failed', message: 'Not supported on Apple TV' } }
export function dismissAuthSession() {}
export function dismissBrowser() {}
