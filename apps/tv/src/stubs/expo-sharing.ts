export async function isAvailableAsync(): Promise<boolean> { return false }
export async function shareAsync(): Promise<void> { throw new Error('Sharing is not available on Apple TV') }
