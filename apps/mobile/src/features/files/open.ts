import type { FileNode } from '@pulpo/contracts'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import * as Sharing from 'expo-sharing'
import { useCallback } from 'react'
import { Alert } from 'react-native'
import { create } from 'zustand'
import type { RootStackParamList } from '../../mockup5/src/navigation'
import { openAttachmentFile } from '../../native/openFile'
import { downloadFile, fetchDocMarkdown, fetchFileNode, markdownExportFile } from './api'
import { filesErrorMessage } from './display'
import { fileOpenTarget } from './itemActions'

/** Uploaded files being fetched to open or share, so their rows can show progress. */
export const useFileDownloads = create<{ active: Record<string, true>; set: (id: string, active: boolean) => void }>((set) => ({
  active: {},
  set: (id, active) => set((state) => {
    const next = { ...state.active }
    if (active) next[id] = true
    else delete next[id]
    return { active: next }
  }),
}))

async function withDownload<T>(id: string, task: () => Promise<T>): Promise<T> {
  useFileDownloads.getState().set(id, true)
  try {
    return await task()
  } finally {
    useFileDownloads.getState().set(id, false)
  }
}

/** Opens an uploaded file with the system viewer (Quick Look, or the sandboxed page viewer for HTML). */
export async function previewUploadedFile(node: FileNode): Promise<void> {
  const file = await withDownload(node.id, () => downloadFile(node))
  await openAttachmentFile(file.uri, node.name, node.mimeType ?? undefined)
}

/** Shares an uploaded file's bytes, or a document's Markdown (`markdown` from an open editor wins). */
export async function shareFileItem(node: FileNode, markdown?: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing isn’t available on this device.')
  if (node.kind === 'doc') {
    const text = markdown ?? (await fetchDocMarkdown(node.id)).markdown
    const file = markdownExportFile(node.name, text)
    await Sharing.shareAsync(file.uri, { mimeType: 'text/markdown', UTI: 'net.daringfireball.markdown', dialogTitle: node.name })
    return
  }
  const file = await withDownload(node.id, () => downloadFile(node))
  await Sharing.shareAsync(file.uri, { mimeType: node.mimeType ?? undefined, dialogTitle: node.name })
}

/** Opens any Files item the way the web does: folders and documents in their screens, files in a viewer. */
export function useOpenFileItem() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  return useCallback(async (node: FileNode) => {
    const target = fileOpenTarget(node)
    try {
      switch (target.type) {
        case 'folder': navigation.push('FilesFolder', { folderId: target.id, name: target.name }); return
        case 'document': navigation.push('FileDocument', { fileId: target.id, name: target.name }); return
        case 'markdown': navigation.push('FileMarkdown', { fileId: target.id, name: target.name }); return
        case 'chat': navigation.navigate('Chat', { chatId: target.id }); return
        case 'unavailable': Alert.alert('Can’t open this item', target.reason); return
        case 'file': {
          const file = target.node ?? (await fetchFileNode(target.id)).node
          await previewUploadedFile(file)
        }
      }
    } catch (error) {
      Alert.alert(`Couldn’t open “${node.name}”`, filesErrorMessage(error, node.name))
    }
  }, [navigation])
}
