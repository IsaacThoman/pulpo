import { Directory, File, FileMode } from 'expo-file-system'

const CHUNK_BYTES = 1024 * 1024

export const supportsSaveToPhotos = false
export const supportsSaveToDevice = true

export async function saveImageToPhotos(_uri: string): Promise<void> {
  throw new Error('Saving to Photos is unavailable on this device.')
}

function isPickerCancelled(error: unknown): boolean {
  const { code, message } = error as { code?: string; message?: string }
  return code === 'ERR_PICKER_CANCELLED' || /cancel/i.test(message ?? '')
}

/** Asks for a folder (Storage Access Framework) and copies the file there; `false` when cancelled. */
export async function saveFileToDevice(uri: string, name: string, mimeType?: string): Promise<boolean> {
  let directory: Directory
  try {
    directory = await Directory.pickDirectoryAsync()
  } catch (error) {
    if (isPickerCancelled(error)) return false
    throw error
  }
  // Open the source first: it can disappear while the picker is open (a cached download evicted),
  // and failing then must not leave an empty file in the user's folder.
  const input = new File(uri).open(FileMode.ReadOnly)
  try {
    // The provider numbers the name when the folder already has it.
    const destination = directory.createFile(name, mimeType || 'application/octet-stream')
    try {
      const output = destination.open(FileMode.WriteOnly)
      try {
        for (;;) {
          const chunk = input.readBytes(CHUNK_BYTES)
          if (!chunk.length) break
          output.writeBytes(chunk)
          // Large files copy in steps so the interface keeps responding.
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
      } finally {
        output.close()
      }
    } catch (error) {
      try { destination.delete() } catch { /* The partial copy is the user's to remove. */ }
      throw error
    }
  } finally {
    input.close()
  }
  return true
}
