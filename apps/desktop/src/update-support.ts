export function desktopUpdatesSupported(
  packaged: boolean,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): boolean {
  if (!packaged) return false
  if (platform === 'darwin') return true
  return platform === 'win32' && arch === 'x64'
}
