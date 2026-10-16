/** Content that can run inside the isolated preview sandbox. */
export type CodePreviewKind = 'html' | 'svg' | 'jsx'

const EXTENSION_KINDS: Record<string, CodePreviewKind> = {
  html: 'html',
  htm: 'html',
  svg: 'svg',
  jsx: 'jsx',
  tsx: 'jsx',
}

export function previewKindForFile(name: string, mimeType = ''): CodePreviewKind | null {
  const extension = name.trim().toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1]
  if (extension && EXTENSION_KINDS[extension]) return EXTENSION_KINDS[extension]
  const mime = mimeType.toLowerCase()
  if (mime === 'text/html') return 'html'
  if (mime === 'image/svg+xml') return 'svg'
  return null
}
