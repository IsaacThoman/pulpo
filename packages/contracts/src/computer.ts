import { z } from 'zod'

/**
 * "This computer": the desktop app lends the agent the computer it runs on.
 *
 * - `full`: the computer is the agent's workspace. Its tools (shell, read, write, …) run there,
 *   starting in the chosen folder or a default one, and may leave it. No cloud workspace is used.
 *   Where the app can, the agent may also see and work in other apps' windows, one app at a time
 *   and only after the user allowed that app (the `app.*` requests below).
 * - `read` / `suggest` / `write`: the agent keeps its cloud workspace and reaches one chosen folder
 *   through `pulpo computer` in bash, the way it reaches Files through `pulpo files`. Nothing runs
 *   on the computer. The three modes mean what they mean for Files.
 *
 * The server never dials the computer. Every request travels over the realtime socket to the
 * desktop app that sent the message (`computer.request` → `computer.response`), and file bytes
 * move through one-time transfer URLs.
 */
export const COMPUTER_ACCESS_MODES = ['full', 'read', 'suggest', 'write'] as const
export const computerAccessSchema = z.enum(COMPUTER_ACCESS_MODES)
export type ComputerAccess = z.infer<typeof computerAccessSchema>
/** The modes that sync a folder with the cloud workspace; the same values as `FileAccessMode`. */
export type ComputerFolderMode = Exclude<ComputerAccess, 'full'>
export function isComputerFolderMode(access: ComputerAccess): access is ComputerFolderMode { return access !== 'full' }

/** Longest absolute folder path accepted from a desktop app. */
export const COMPUTER_PATH_MAX_LENGTH = 4_096

/**
 * What a message carries when the agent should use the sender's computer. The desktop app makes
 * `sessionId` for each message and tells its main process what that session may do before the
 * message is sent; the main process serves only requests that name a session it knows.
 */
export const computerSelectionSchema = z.object({
  sessionId: z.uuid(),
  access: computerAccessSchema,
  /** Absolute path of the chosen folder. Null only with full access, which then starts in the default folder. */
  folder: z.string().min(1).max(COMPUTER_PATH_MAX_LENGTH).nullable(),
}).refine((value) => value.access === 'full' || value.folder !== null, {
  message: 'Choose a folder to use this access mode',
  path: ['folder'],
})
export type ComputerSelection = z.infer<typeof computerSelectionSchema>

/** A folder the user picked in the desktop app's native folder dialog. */
export interface ComputerFolder {
  /** Absolute path. */
  path: string
  /** The last path segment, for display. */
  name: string
}

/** What the agent is told about the computer before it runs anything there. */
export const computerDescriptionSchema = z.object({
  os: z.enum(['macos', 'windows', 'linux']),
  /** Readable, with the system's name: `macOS 15.2`, `Windows 11 (10.0.26100)`, `Linux 6.8.0`. */
  osVersion: z.string().max(100),
  arch: z.string().max(40),
  /** The shell that runs commands, e.g. `zsh`, `bash`, `pwsh`, `powershell`. */
  shell: z.string().max(40),
  home: z.string().max(COMPUTER_PATH_MAX_LENGTH),
  /** Where commands start: the chosen folder, or the default one. */
  cwd: z.string().max(COMPUTER_PATH_MAX_LENGTH),
  /** Where files the user sent in the chat are saved for the agent. */
  attachmentsDir: z.string().max(COMPUTER_PATH_MAX_LENGTH),
  /**
   * Where `pulpo files` keeps its copies of the user's Files on this computer (what
   * `/workspace/files` is in a cloud workspace). Absent when the app cannot run `pulpo files`
   * for the agent's commands, and then Files are not offered in a full-access reply.
   */
  filesDir: z.string().max(COMPUTER_PATH_MAX_LENGTH).optional(),
  /**
   * Present when the app can show the agent other apps' windows and act in them (`app.list`,
   * `app.act`); absent from apps that cannot, and then the app tools are not offered.
   * `background`: what the agent does reaches an app without moving the user's pointer, taking
   * their keyboard or bringing the app forward (macOS). False where the app comes to the front and
   * the user's own pointer and keyboard are used (Windows).
   */
  apps: z.object({ version: z.number().int(), background: z.boolean() }).optional(),
})
export type ComputerDescription = z.infer<typeof computerDescriptionSchema>

/**
 * A one-time URL for one file's bytes, relative to the instance origin (it always starts with
 * `COMPUTER_TRANSFER_PATH`). The desktop app's main process sends the bytes with `PUT` or fetches
 * them with `GET`; the token in the URL is the only credential.
 */
export interface ComputerTransfer { url: string }
export const COMPUTER_TRANSFER_PATH = '/api/computer/transfers/'
export const computerTransferSchema = z.object({
  url: z.string().max(2_048).refine((url) => url.startsWith(COMPUTER_TRANSFER_PATH) && !url.includes('..'), 'Invalid transfer URL'),
})
/**
 * Files up to this size skip the transfer URL and ride inside the request or its answer as
 * base64 (`data`), which saves a round trip per file. It must fit a socket message comfortably.
 */
export const COMPUTER_INLINE_MAX_BYTES = 256 * 1024
const inlineData = z.string().max(Math.ceil(COMPUTER_INLINE_MAX_BYTES / 3) * 4 + 4)
/** Bytes coming from the server: inline, or behind a transfer URL. Exactly one is set. */
const incomingBytes = { data: inlineData.optional(), transfer: computerTransferSchema.optional() }
const oneSource = (value: { data?: string; transfer?: unknown }) => (value.data === undefined) !== (value.transfer === undefined)
const oneSourceMessage = 'Send the bytes inline or through a transfer, not both'

// ---------------------------------------------------------------------------------------------
// Full access: the workspace daemon's operation protocol, served by the desktop app.
// ---------------------------------------------------------------------------------------------

/** `bash` runs the command in the computer's own shell (see `ComputerDescription.shell`). */
export const COMPUTER_OPERATION_TYPES = ['bash', 'read', 'write', 'edit', 'list', 'find', 'grep'] as const
export type ComputerOperationType = typeof COMPUTER_OPERATION_TYPES[number]

/**
 * A `pulpo` command run by the agent's shell command (`pulpo files …`), held by the desktop app
 * until the server answers it with `operation.relay`, the way the workspace daemon holds one.
 * Agent-controlled input: the server validates `command` and `args`.
 */
export const computerRelayRequestSchema = z.object({
  id: z.string().min(1).max(200),
  command: z.string().max(200),
  args: z.unknown(),
})
export type ComputerRelayRequest = z.infer<typeof computerRelayRequestSchema>

/** The server's answer to a relay request, as the `pulpo` command receives it. */
export const computerRelayResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), output: z.string(), data: z.unknown().optional() }),
  z.object({ ok: z.literal(false), error: z.string() }),
])
export type ComputerRelayResult = z.infer<typeof computerRelayResultSchema>

/** The same shape the workspace daemon answers with; `output` is everything printed so far. */
export const computerOperationSchema = z.object({
  id: z.string().min(1).max(200),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  output: z.string(),
  exitCode: z.number().int().nullable(),
  error: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  /** Relay requests waiting for an answer. Present (version 1) on apps that relay `pulpo files`; a long-poll returns at once when one arrives. */
  relay: z.object({ version: z.number().int(), pending: z.array(computerRelayRequestSchema).max(100) }).optional(),
})
export type ComputerOperation = z.infer<typeof computerOperationSchema>
/**
 * The most output characters one answer carries. Every poll repeats the output so far, so a long
 * one is cut in the middle for the trip; the desktop app saves the whole of it to a file named in
 * `details`, which the agent can read.
 */
export const COMPUTER_OPERATION_OUTPUT_MAX_CHARACTERS = 200_000

// ---------------------------------------------------------------------------------------------
// Folder modes: what `pulpo computer` needs from the chosen folder.
// ---------------------------------------------------------------------------------------------

/** A path inside the chosen folder: `/`-separated, relative, `''` for the folder itself. */
export const computerFolderPathSchema = z.string().max(COMPUTER_PATH_MAX_LENGTH)

export const computerFolderEntrySchema = z.object({
  path: computerFolderPathSchema,
  kind: z.enum(['file', 'folder']),
  sizeBytes: z.number().int().nonnegative(),
  modifiedAt: z.string(),
})
export type ComputerFolderEntry = z.infer<typeof computerFolderEntrySchema>

/** A change `pulpo computer push|mkdir|mv|rm` asks for. The desktop app applies or stages it by the session's mode. */
export const computerFolderChangeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('put'),
    path: computerFolderPathSchema.min(1),
    ...incomingBytes,
    sizeBytes: z.number().int().nonnegative(),
    /** The version the agent pulled, or null when it believes the file is new. */
    base: z.string().max(200).nullable(),
    force: z.boolean().optional(),
  }).refine(oneSource, oneSourceMessage),
  z.object({ kind: z.literal('mkdir'), path: computerFolderPathSchema.min(1), parents: z.boolean().optional() }),
  z.object({ kind: z.literal('move'), from: computerFolderPathSchema.min(1), to: computerFolderPathSchema.min(1) }),
  z.object({ kind: z.literal('remove'), path: computerFolderPathSchema.min(1), recursive: z.boolean().optional() }),
])
export type ComputerFolderChange = z.infer<typeof computerFolderChangeSchema>

export const computerFolderChangeResultSchema = z.object({
  status: z.enum(['created', 'updated', 'suggested', 'unchanged', 'conflict', 'denied', 'error']),
  /** For the agent; empty when the status says it all. */
  message: z.string(),
  /** The file's version after the change, or the one it now has on a conflict. */
  version: z.string().optional(),
})
export type ComputerFolderChangeResult = z.infer<typeof computerFolderChangeResultSchema>

// ---------------------------------------------------------------------------------------------
// Full access: seeing and working in other apps' windows.
// ---------------------------------------------------------------------------------------------

/** An app that is running with a window open, as `app.list` reports it. */
export const computerAppSchema = z.object({
  /** As the user knows it: `TextEdit`, `Notepad`. The agent names an app by this. */
  name: z.string().max(200),
  /** Whether the user already let the agent use it. Using any other app asks them first. */
  allowed: z.boolean(),
  /** The app the user is working in. */
  frontmost: z.boolean(),
  /** Its windows' titles, front to back. Left out for an app the user has not allowed. */
  windows: z.array(z.string().max(500)).max(50),
})
export type ComputerApp = z.infer<typeof computerAppSchema>

/** The most text one `type` action carries; more is typed in several actions, or set with `set_value`. */
export const COMPUTER_APP_TYPE_MAX_CHARACTERS = 2_000

/** A coordinate in a window's picture, in that picture's pixels. */
const appCoordinate = z.number().finite().min(0).max(100_000)
const appElementIndex = z.number().int().min(1).max(100_000)

/**
 * One thing to do in an app's window. `view` only looks. Coordinates and element numbers are those
 * of the last answer about that window: every answer carries its picture and elements anew.
 */
export const computerAppActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('view') }),
  /** A click on an element, or at a point when no element is named. */
  z.object({
    type: z.literal('click'),
    element: appElementIndex.optional(),
    x: appCoordinate.optional(),
    y: appCoordinate.optional(),
    button: z.enum(['left', 'right', 'middle']).default('left'),
    count: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  }).refine((value) => value.element !== undefined || (value.x !== undefined && value.y !== undefined), 'Name an element or give both x and y'),
  /** Types text into whatever has the keyboard focus in the window. Windows types a character at a time (about 60 a second), so the length is bounded by `COMPUTER_APP_ACT_TIMEOUT_MS`. */
  z.object({ type: z.literal('type'), text: z.string().min(1).max(COMPUTER_APP_TYPE_MAX_CHARACTERS) }),
  /** One key or chord: `enter`, `escape`, `cmd+s`, `ctrl+shift+t`. */
  z.object({ type: z.literal('key'), keys: z.string().min(1).max(100) }),
  /** Scrolls at an element, at a point, or in the middle of the window, by lines; positive `dy` moves down the page. */
  z.object({
    type: z.literal('scroll'),
    element: appElementIndex.optional(),
    x: appCoordinate.optional(),
    y: appCoordinate.optional(),
    dx: z.number().int().min(-100).max(100).default(0),
    dy: z.number().int().min(-100).max(100).default(0),
  }).refine((value) => value.dx !== 0 || value.dy !== 0, 'Scroll by at least one line'),
  z.object({ type: z.literal('drag'), fromX: appCoordinate, fromY: appCoordinate, toX: appCoordinate, toY: appCoordinate }),
  /** Sets what an element holds without typing: a field's text, a slider's number. */
  z.object({ type: z.literal('set_value'), element: appElementIndex, value: z.string().max(10_000) }),
])
export type ComputerAppAction = z.infer<typeof computerAppActionSchema>
export type ComputerAppActionInput = z.input<typeof computerAppActionSchema>

/** One element of a window. Its box is in the pixels of the picture it came with. */
export const computerAppElementSchema = z.object({
  /** What the agent names it by in its next action on this window. */
  index: appElementIndex,
  /** How deep it sits below the elements listed before it. */
  depth: z.number().int().min(0).max(100),
  /** `button`, `textfield`, `checkbox`, `link`, `menuitem`, `text`, … */
  role: z.string().max(40),
  label: z.string().max(200).optional(),
  value: z.string().max(200).optional(),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
  focused: z.boolean().optional(),
  enabled: z.boolean().optional(),
})
export type ComputerAppElement = z.infer<typeof computerAppElementSchema>

/** The most elements one answer lists; a window with more says so in `truncated`. */
export const COMPUTER_APP_MAX_ELEMENTS = 300
/** No picture of a window is wider or taller than this, in pixels. */
export const COMPUTER_APP_IMAGE_MAX_EDGE = 1_280
/**
 * How long the desktop app waits for the user to answer when the agent wants an app they have not
 * allowed yet. Unanswered, the app is not used.
 */
export const COMPUTER_APP_APPROVAL_TIMEOUT_MS = 120_000
/** How long the desktop app may take to do one thing in a window and look at it again. */
export const COMPUTER_APP_ACT_TIMEOUT_MS = 60_000

/**
 * A window after `app.act`: its picture and what is in it. The picture shows that window alone,
 * never the rest of the screen. It rides inline when it is small (`data`); otherwise `path` names
 * it on the computer and the server fetches it with `file.send`.
 */
export const computerAppStateSchema = z.object({
  app: z.string().max(200),
  /** The title of the window shown. After an action that opened a window (a dialog), that one. */
  window: z.string().max(500),
  /** The titles of all the app's windows now, front to back, so one that opened or closed is noticed. */
  windows: z.array(z.string().max(500)).max(50).optional(),
  /** What the action did, when that is worth saying ("Pressed the Save button"). */
  note: z.string().max(1_000).optional(),
  image: z.object({
    mimeType: z.enum(['image/jpeg', 'image/png']),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    sizeBytes: z.number().int().nonnegative(),
    data: inlineData.optional(),
    path: z.string().min(1).max(COMPUTER_PATH_MAX_LENGTH).optional(),
  }).refine((value) => (value.data === undefined) !== (value.path === undefined), 'Send the picture inline or name its file, not both'),
  elements: z.array(computerAppElementSchema).max(1_000),
  /** The window has more elements than were listed. */
  truncated: z.boolean(),
})
export type ComputerAppState = z.infer<typeof computerAppStateSchema>

// ---------------------------------------------------------------------------------------------
// The requests the server sends to the desktop app.
// ---------------------------------------------------------------------------------------------

const operationId = z.string().min(1).max(200)
const absolutePath = z.string().min(1).max(COMPUTER_PATH_MAX_LENGTH)

/** Parameters and results of every method. Results are validated by the server; parameters by the desktop app. */
export const computerMethods = {
  describe: { params: z.object({}), result: computerDescriptionSchema },

  // Full access only.
  'operation.start': {
    params: z.object({ id: operationId, type: z.enum(COMPUTER_OPERATION_TYPES), args: z.record(z.string(), z.unknown()) }),
    result: computerOperationSchema,
  },
  /** Returns early when the operation stops or prints something new; otherwise after `waitMs`. */
  'operation.get': { params: z.object({ id: operationId, waitMs: z.number().int().min(0).max(25_000).optional() }), result: computerOperationSchema },
  'operation.cancel': { params: z.object({ id: operationId }), result: computerOperationSchema },
  /** Answers one pending relay request of a running operation. `delivered` is false when the command no longer waits for it. */
  'operation.relay': {
    params: z.object({ requestId: z.string().min(1).max(200), result: computerRelayResultSchema }),
    result: z.object({ delivered: z.boolean() }),
  },
  /** Sends a file on the computer to the server (attach_file, view_image): inline when it is small, else through the transfer. */
  'file.send': {
    params: z.object({ path: absolutePath, transfer: computerTransferSchema, maxBytes: z.number().int().positive() }),
    result: z.object({ sizeBytes: z.number().int().nonnegative(), data: inlineData.optional() }),
  },
  /** Saves a file from the server on the computer (chat attachments, generated images). */
  'file.receive': {
    params: z.object({
      path: absolutePath,
      ...incomingBytes,
      sizeBytes: z.number().int().nonnegative(),
      /** Hex SHA-256 of the bytes, when known; the desktop app rejects a mismatch. */
      sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    }).refine(oneSource, oneSourceMessage),
    result: z.object({ path: z.string() }),
  },
  /** Which of these files are absent or differ, so only those are sent. */
  'file.missing': {
    params: z.object({ files: z.array(z.object({ path: absolutePath, sizeBytes: z.number().int().nonnegative(), sha256: z.string().nullable() })).max(500) }),
    result: z.object({ missing: z.array(z.string()) }),
  },

  /** The apps running with a window open (full access, on apps that describe `apps`). */
  'app.list': { params: z.object({}), result: z.object({ apps: z.array(computerAppSchema).max(200) }) },
  /**
   * Does one thing in an app's window and answers with the window as it is afterwards. `app` is a
   * name from `app.list`; `window` picks one of its windows by part of its title, else the front
   * one for `view` and the one last shown for anything else (a click means something only in the
   * picture the agent saw). An app the user has not allowed yet is asked about first, in a native
   * dialog, and the request waits for the answer (`COMPUTER_APP_APPROVAL_TIMEOUT_MS`): refused, it
   * fails with `not_allowed`.
   */
  'app.act': {
    params: z.object({ app: z.string().min(1).max(200), window: z.string().min(1).max(500).optional(), action: computerAppActionSchema }),
    result: computerAppStateSchema,
  },

  // Folder modes only. Paths are relative to the session's folder.
  /** Entries below `path`, depth-first in name order, `depth` levels deep (1: direct children). */
  'folder.list': {
    params: z.object({
      path: computerFolderPathSchema,
      depth: z.number().int().min(1).max(64),
      limit: z.number().int().min(1).max(10_000),
      /** Leave out folders (pull planning). */
      filesOnly: z.boolean().optional(),
    }),
    result: z.object({
      /** When `path` is a file, just that file. */
      entries: z.array(computerFolderEntrySchema),
      truncated: z.boolean(),
      /** Folders left out by name (`.git`, `node_modules`), relative to the session's folder. */
      skipped: z.array(z.string()).optional(),
    }),
  },
  /** A UTF-8 text file's contents. Fails for anything else. */
  'folder.read': {
    params: z.object({ path: computerFolderPathSchema.min(1), maxBytes: z.number().int().positive() }),
    result: z.object({ text: z.string(), sizeBytes: z.number().int().nonnegative(), truncated: z.boolean() }),
  },
  'folder.search': {
    params: z.object({
      pattern: z.string().min(1).max(1_000),
      path: computerFolderPathSchema,
      ignoreCase: z.boolean().optional(),
      /** Match the pattern as plain text, not a regular expression. */
      fixed: z.boolean().optional(),
      limit: z.number().int().min(1).max(5_000),
    }),
    result: z.object({
      matches: z.array(z.object({ path: computerFolderPathSchema, line: z.number().int().positive(), text: z.string() })),
      truncated: z.boolean(),
    }),
  },
  /**
   * Sends one file in the folder to the server (pull): inline when it is small, else through the
   * transfer. `version` identifies these exact bytes; a later `put` names it as its `base`.
   */
  'folder.send': {
    params: z.object({ path: computerFolderPathSchema.min(1), transfer: computerTransferSchema, maxBytes: z.number().int().positive() }),
    result: z.object({ sizeBytes: z.number().int().nonnegative(), version: z.string().max(200), data: inlineData.optional() }),
  },
  /** Applies a change, or stages it as a suggestion, by the session's mode. `responseId` groups a reply's changes. */
  'folder.change': {
    params: z.object({ change: computerFolderChangeSchema, responseId: z.uuid() }),
    result: computerFolderChangeResultSchema,
  },
} as const

export type ComputerMethod = keyof typeof computerMethods
export const COMPUTER_METHODS = Object.keys(computerMethods) as ComputerMethod[]
export type ComputerParams<M extends ComputerMethod> = z.input<typeof computerMethods[M]['params']>
export type ComputerResult<M extends ComputerMethod> = z.output<typeof computerMethods[M]['result']>

/** Why the desktop app refused or failed a request. `message` is written for the agent. */
export const COMPUTER_ERROR_CODES = [
  /** The app does not know the session: it was restarted, or the message came from elsewhere. */
  'unknown_session',
  /** The session's access mode does not allow the method. */
  'not_allowed',
  /** A path left the session's folder. */
  'outside_folder',
  'not_found',
  /** Not UTF-8 text, where text was needed. */
  'not_text',
  'too_large',
  'invalid_request',
  'failed',
] as const
export type ComputerErrorCode = typeof COMPUTER_ERROR_CODES[number]

/** Socket event `computer.request`, server → desktop app. */
export const computerRequestSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  method: z.enum(COMPUTER_METHODS as [ComputerMethod, ...ComputerMethod[]]),
  params: z.unknown(),
  /** How long the server waits for the answer. */
  timeoutMs: z.number().int().positive(),
})
export type ComputerRequest = z.infer<typeof computerRequestSchema>

/** Socket event `computer.response`, desktop app → server. */
export const computerResponseSchema = z.discriminatedUnion('ok', [
  z.object({ id: z.uuid(), sessionId: z.uuid(), ok: z.literal(true), result: z.unknown() }),
  z.object({ id: z.uuid(), sessionId: z.uuid(), ok: z.literal(false), code: z.enum(COMPUTER_ERROR_CODES), message: z.string().max(4_000) }),
])
export type ComputerResponse = z.infer<typeof computerResponseSchema>

/**
 * Socket event `computer.host`, desktop app → server: the sessions this app serves right now.
 * Sent after connecting and whenever the list changes, and repeated as a heartbeat; the server
 * forgets a session it has not heard about for `COMPUTER_HOST_TTL_MS`.
 */
export const computerHostSchema = z.object({ sessionIds: z.array(z.uuid()).max(200) })
export type ComputerHost = z.infer<typeof computerHostSchema>
export const COMPUTER_HOST_HEARTBEAT_MS = 15_000
export const COMPUTER_HOST_TTL_MS = 45_000

/** How long the server waits for an ordinary answer; long-polls add their `waitMs`. */
export const COMPUTER_REQUEST_TIMEOUT_MS = 30_000
/** Requests that move a file get longer. */
export const COMPUTER_TRANSFER_TIMEOUT_MS = 300_000
/**
 * How long a request that moves `sizeBytes` may take: the usual allowance, or longer for a big
 * file, enough for a slow home uplink (about 2 Mbps), up to an hour.
 */
export function computerTransferTimeoutMs(sizeBytes: number): number {
  return Math.min(3_600_000, Math.max(COMPUTER_TRANSFER_TIMEOUT_MS, Math.ceil(sizeBytes / 250_000) * 1_000))
}

/** Largest file `pulpo computer pull` copies into the workspace, and the most one pull may hold. */
export const COMPUTER_PULL_MAX_FILE_BYTES = 1_000 * 1024 * 1024
export const COMPUTER_PULL_MAX_BYTES = 500 * 1024 * 1024
export const COMPUTER_PULL_MAX_FILES = 1_000
/** Largest file `pulpo computer push` saves back; the workspace daemon exports no more. */
export const COMPUTER_PUSH_MAX_FILE_BYTES = 25 * 1024 * 1024
/** Folders `pulpo computer` leaves out of listings deeper than one level, pulls and searches. */
export const COMPUTER_SKIPPED_FOLDERS = ['.git', 'node_modules'] as const

// ---------------------------------------------------------------------------------------------
// What a reply shows, and what the desktop app keeps for review.
// ---------------------------------------------------------------------------------------------

/**
 * A reply's response item announcing it changed, or suggested changes to, the folder on the
 * user's computer. The changes themselves never leave that computer: the desktop app that owns
 * `session_id` lists them from its own store.
 */
export interface ComputerChangesItem {
  type: 'pulpo_computer_changes'
  id: string
  session_id: string
  /** Changes applied so far. */
  applied: number
  /** Changes waiting for the user to accept or reject. */
  suggested: number
}

/**
 * One change the desktop app keeps: a suggestion waiting for review, or a record of what was done.
 *
 * While a suggested file (`create` / `update`) is pending, the agent sees the folder as if it were
 * accepted, the way it sees Files: listings, reads, searches, pulls and conflict checks use the
 * suggested contents, and a newer suggestion for the same file replaces the pending one. Pending
 * `mkdir`, `move` and `remove` suggestions do not change what the agent sees.
 */
export interface ComputerChange {
  id: string
  sessionId: string
  responseId: string
  /** The folder the change belongs to, and the path inside it. */
  folder: string
  path: string
  /** `create` and `update` carry file contents; `move` has `to`. */
  kind: 'create' | 'update' | 'mkdir' | 'move' | 'remove'
  to?: string
  sizeBytes?: number
  /** `pending`: suggested and undecided. `conflict`: accepting failed because the file changed since. */
  status: 'pending' | 'applied' | 'accepted' | 'rejected' | 'conflict'
  createdAt: string
}

/** A change with what the review needs to show it. Text is included only for UTF-8 files up to 1 MiB. */
export interface ComputerChangeDetail extends ComputerChange {
  before: string | null
  after: string | null
  /** Either side is not text or is too large to show. */
  binary: boolean
}

/** An app the user let the agent see and work in. `id` is the system's own name for it (a bundle identifier, an executable's name). */
export interface ComputerAllowedApp { id: string; name: string }

/** What `window.pulpoDesktop.computer` offers the web code. Everything here runs in the main process. */
export interface DesktopComputerApi {
  /**
   * What the user has allowed so far for the signed-in account. `signedIn` is false when the app
   * could not tell which account is signed in (it asks the instance), and then nothing can be
   * allowed or used; absent from apps that predate it.
   */
  status(): Promise<{
    fullAccess: boolean
    folders: ComputerFolder[]
    defaultFolder: ComputerFolder
    signedIn?: boolean
    /** The apps the user let the agent see and work in, most recently allowed first; absent from apps that cannot do that. */
    apps?: ComputerAllowedApp[]
  }>
  /** Opens the native folder dialog; the chosen folder becomes usable. Null when the user cancels. */
  chooseFolder(): Promise<ComputerFolder | null>
  /** Asks, in a native dialog the first time, whether the agent may run commands on this computer. */
  allowFullAccess(): Promise<boolean>
  /** Takes full access back: sessions using it end, and the next use asks again. */
  revokeFullAccess(): Promise<void>
  /** Forgets a folder the user allowed: sessions using it end, and it must be chosen again to be used. */
  forgetFolder(path: string): Promise<void>
  /** Forgets an app the user allowed: the agent must ask again to use it. Absent from apps that cannot control apps. */
  forgetApp?(id: string): Promise<void>
  /** Registers what a message's session may do. Refused unless the folder and access were allowed above. */
  begin(session: { sessionId: string; access: ComputerAccess; folder: string | null }): Promise<{ ok: true } | { ok: false; reason: 'folder_not_allowed' | 'full_access_not_allowed' | 'signed_out' }>
  /** The session's reply is over; later requests for it are refused. */
  end(sessionId: string): Promise<void>
  /** Sessions still registered, so the app can announce them again after a reload. */
  sessions(): Promise<string[]>
  /** Serves one request from the server. Never rejects: failures come back as `ok: false`. */
  handle(request: ComputerRequest): Promise<ComputerResponse>
  changes: {
    list(filter: { sessionIds?: string[]; folder?: string }): Promise<ComputerChange[]>
    get(id: string): Promise<ComputerChangeDetail | null>
    /** Applies pending suggestions. A file that changed since the suggestion becomes a `conflict` unless `overwrite`. */
    accept(ids: string[], options?: { overwrite?: boolean }): Promise<ComputerChange[]>
    reject(ids: string[]): Promise<ComputerChange[]>
    /** Called after any change is added or decided. Returns the unsubscribe function. */
    onChanged(listener: () => void): () => void
  }
}
