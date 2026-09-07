export function redirectFileIntent(path: string, enqueue: (uri: string) => void): string {
  try {
    if (new URL(path).protocol !== 'file:') return path
    enqueue(path)
    return '/'
  } catch {
    return path
  }
}
