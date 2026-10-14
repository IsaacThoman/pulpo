import type { Readable } from 'node:stream'
import { FILE_TREE_MAX_DEPTH } from '@pulpo/contracts'
import { db } from '../../database/client.js'
import { getBlobStore } from '../../storage/index.js'
import type { FileNodeRow } from '../access.js'
import { formatSize, workspacePath, type CommandContext, type CommandOutput } from './command-context.js'
import { markdownVersion, readProposedMarkdown } from './docs.js'
import { FilesCommandError, locateExisting, modeFor } from './scope.js'
import { agentBlobView, blobVersion } from './versions.js'
import { walkTree } from './walk.js'

const PULL_MAX_FILES = 1_000
const PULL_MAX_BYTES = 500 * 1024 * 1024
/** Folders count toward the walk too; past this the tree is too big to pull in one call anyway. */
const PULL_MAX_NODES = 5_000

export interface PulledFile {
  remote: string
  local: string
  nodeId: string
  version: string
  kind: 'doc' | 'blob'
  sizeBytes: number
}

async function writeLocal(ctx: CommandContext, local: string, body: Uint8Array | Readable, sizeBytes: number): Promise<void> {
  try {
    await ctx.workspace.writeWorkspaceFile(local, body, sizeBytes, ctx.signal)
  } catch (error) {
    throw new FilesCommandError(`Could not write "${local}": ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Writes one file as the agent sees it into the workspace and returns its manifest entry. */
async function pullFile(ctx: CommandContext, node: FileNodeRow, remote: string, local: string): Promise<PulledFile> {
  if (node.kind === 'doc') {
    const markdown = await readProposedMarkdown(node.id)
    // A text file ends with a newline, so a line the agent appends (echo >>) starts a new one.
    const bytes = Buffer.from(markdown && !markdown.endsWith('\n') ? `${markdown}\n` : markdown, 'utf8')
    await writeLocal(ctx, local, bytes, bytes.byteLength)
    return { remote, local, nodeId: node.id, version: markdownVersion(markdown), kind: 'doc', sizeBytes: bytes.byteLength }
  }
  const view = await agentBlobView(db, ctx.chatId, node, () => modeFor(ctx.scope, node.id))
  const body = await getBlobStore().getStream(view.objectKey)
  try {
    await writeLocal(ctx, local, body, view.sizeBytes)
  } finally {
    // Releases the store connection when the write stopped early.
    body.destroy()
  }
  return { remote, local, nodeId: node.id, version: blobVersion(view), kind: 'blob', sizeBytes: view.sizeBytes }
}

/**
 * `pull <path> <dest>`: copies a file, or every file in a folder, into the workspace. Documents
 * arrive as Markdown of their proposed view; `data.files` is what the CLI's manifest records.
 */
export async function pullCommand(ctx: CommandContext, args: { path: string; dest: string }): Promise<CommandOutput> {
  const destination = workspacePath(args.dest)
  const located = await locateExisting(ctx.scope, args.path)
  const items: Array<{ node: FileNodeRow; remote: string; local: string }> = []
  if (located.node && located.node.kind !== 'folder') {
    items.push({ node: located.node, remote: located.path, local: destination })
  } else {
    const { nodes, truncated } = await walkTree(ctx.userId, { id: located.node?.id ?? null, path: located.path }, { maxDepth: FILE_TREE_MAX_DEPTH, maxNodes: PULL_MAX_NODES })
    const files = nodes.filter((item) => item.node.kind !== 'folder')
    if (truncated || files.length > PULL_MAX_FILES) {
      throw new FilesCommandError(`"${located.path || 'My files'}" holds more than ${PULL_MAX_FILES} files; pull the folders inside it one at a time`)
    }
    const prefix = located.path ? located.path.length + 1 : 0
    for (const item of files) items.push({ node: item.node, remote: item.path, local: `${destination}/${item.path.slice(prefix)}` })
  }
  if (items.reduce((total, item) => total + item.node.sizeBytes, 0) > PULL_MAX_BYTES) {
    throw new FilesCommandError(`"${located.path || 'My files'}" is larger than ${formatSize(PULL_MAX_BYTES)}; pull the folders inside it one at a time`)
  }
  const files: PulledFile[] = []
  for (const item of items) {
    ctx.signal?.throwIfAborted()
    files.push(await pullFile(ctx, item.node, item.remote, item.local))
  }
  const what = located.node && located.node.kind !== 'folder' ? `"${located.path}"` : `${files.length} file${files.length === 1 ? '' : 's'} from "${located.path || 'My files'}"`
  const listed = files.length > 1 ? files.slice(0, 50).map((file) => `  ${file.local}`) : []
  if (files.length > 50) listed.push(`  … and ${files.length - 50} more`)
  return { output: [files.length ? `Pulled ${what} into ${destination}` : `"${located.path || 'My files'}" has no files to pull`, ...listed].join('\n'), data: { files } }
}
