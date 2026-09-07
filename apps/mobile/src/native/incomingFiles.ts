import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Crypto from 'expo-crypto'
import { Directory, File, Paths } from 'expo-file-system'
import FileImport from '../../modules/pulpo-file-import'
import { IncomingFileQueue } from '../features/chat/incomingFileQueue'
import { cacheNamespace } from '../data/database'
import { useSessionStore } from '../store/session'

export function releaseImportedFile(uri: string) {
  const root = new Directory(Paths.document, 'incoming-files').uri.replace(/\/+$/, '') + '/'
  if (!uri.startsWith(root)) return
  try {
    const file = new File(uri)
    if (file.exists) file.delete()
    // Each import owns exactly one UUID directory.
    const parent = file.parentDirectory
    if (parent.exists && parent.list().length === 0) parent.delete()
  } catch { /* Logout or another cleanup may already have released the copy. */ }
}

const STORAGE_KEY = 'pulpo:incoming-files:v1'
export const incomingFiles = new IncomingFileQueue({
  uuid: () => Crypto.randomUUID(),
  load: async () => JSON.parse(await AsyncStorage.getItem(STORAGE_KEY) ?? '[]'),
  save: (items) => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items)),
  copy: async (source) => {
    if (!FileImport) throw new Error('File importing requires an updated iOS build of Pulpo.')
    return FileImport.importFile(source)
  },
  release: (file) => releaseImportedFile(file.uri),
})

function updateIdentity() {
  const session = useSessionStore.getState()
  const namespace = session.status === 'hydrating' ? undefined : session.user && session.status === 'authenticated'
    ? cacheNamespace(session.instanceUrl, session.user.id) : null
  void incomingFiles.setIdentity(namespace).catch(() => undefined)
}
useSessionStore.subscribe(updateIdentity)
updateIdentity()
