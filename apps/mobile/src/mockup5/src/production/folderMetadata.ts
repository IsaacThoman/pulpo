import type { ServerFolder } from '../../../types'
import type { PrototypeFolder } from '../domain'

export function mergeServerFolders(serverFolders: ServerFolder[], existingFolders: PrototypeFolder[]): PrototypeFolder[] {
  return serverFolders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    expanded: existingFolders.find((item) => item.id === folder.id)?.expanded ?? true,
  }))
}
