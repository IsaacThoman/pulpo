/**
 * Where a `pulpo` command group keeps its items. Both groups share the commands, the local mirror
 * and the manifest logic; only the relay command names and the words in messages differ.
 */
export interface CliStore {
  /** `pulpo <group> <command>`. */
  group: 'files' | 'computer'
  /** Prepended to relay command names, so Pulpo knows which store a request is for. */
  relayPrefix: string
  /** Where the items live, after "in" in messages: "in Files". */
  place: string
  /** What `--to` names. */
  pathNoun: string
}

export const FILES_STORE: CliStore = { group: 'files', relayPrefix: '', place: 'Files', pathNoun: 'Files path' }
export const COMPUTER_STORE: CliStore = { group: 'computer', relayPrefix: 'computer:', place: 'the folder on the user\'s computer', pathNoun: 'path in the folder' }

export const CLI_STORES = { files: FILES_STORE, computer: COMPUTER_STORE } as const
export type CliGroup = keyof typeof CLI_STORES

export const isGroup = (value: string | undefined): value is CliGroup => value !== undefined && Object.hasOwn(CLI_STORES, value)
