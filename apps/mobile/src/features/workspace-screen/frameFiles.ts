import { Directory, File, Paths } from 'expo-file-system'

/**
 * Pictures of the workspace's screen on their way to the screen. Each one gets its own file, so an
 * image view never mistakes a new picture for one it already decoded, and is deleted as soon as a
 * newer one is showing; nothing stays once the viewer closes.
 */
const directory = () => new Directory(Paths.cache, 'workspace-screen')
let sequence = 0

export function writeFrame(bytes: Uint8Array): string {
  const folder = directory()
  folder.create({ idempotent: true, intermediates: true })
  sequence += 1
  const file = new File(folder, `frame-${Date.now()}-${sequence}.jpg`)
  file.write(bytes)
  return file.uri
}

export function deleteFrame(uri: string): void {
  try {
    const file = new File(uri)
    if (file.exists) file.delete()
  } catch {
    // Cleared with the rest of the folder when the viewer closes.
  }
}

export function clearFrames(): void {
  try {
    const folder = directory()
    if (folder.exists) folder.delete()
  } catch {
    // The app cache is the system's to clear as well.
  }
}
