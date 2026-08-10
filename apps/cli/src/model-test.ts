import { randomUUID } from 'node:crypto'
import type { Writable } from 'node:stream'
import { io as createSocket, type Socket } from 'socket.io-client'
import {
  applyResponseEventToSnapshot,
  mergeResponseSnapshots,
  type ChatPreset,
  type ClientToServerEvents,
  type ResponseEvent,
  type ResponseSnapshot,
  type ServerToClientEvents,
} from '@pulpo/contracts'
import type { PulpoManagementClient } from '@pulpo/client-core'
import type { CliIo } from './io.js'

export interface TestableModel {
  id: string
  name: string
  agentEnabled: boolean
  presets: ChatPreset[]
}

export interface ModelCatalog {
  agentAvailable: boolean
  data: TestableModel[]
}

export interface ModelTestResult {
  chatId: string
  responseId: string
  modelId: string
  agentMode: boolean
  presetSelections: Record<string, string>
  temporary: boolean
  snapshot: ResponseSnapshot
}

export interface FollowResponseInput {
  baseUrl: string
  token: string
  snapshot: ResponseSnapshot
  onEvent?: (event: ResponseEvent) => void
  onSnapshot?: (snapshot: ResponseSnapshot) => void
}

type PulpoSocket = Socket<ServerToClientEvents, ClientToServerEvents>

export type FollowResponse = (input: FollowResponseInput) => Promise<ResponseSnapshot>

export function explicitAgentMode(options: { agentEnabled?: boolean; agentDisabled?: boolean }): boolean {
  const enabled = options.agentEnabled === true
  const disabled = options.agentDisabled === false
  if (enabled === disabled) {
    throw selectionError(['choose --agent or --no-agent'])
  }
  return enabled
}

function terminal(snapshot: ResponseSnapshot): boolean {
  return snapshot.status !== 'queued' && snapshot.status !== 'in_progress'
}

/** Follow a response with cursor-based replay so connecting after creation cannot lose output. */
export async function followResponse(input: FollowResponseInput): Promise<ResponseSnapshot> {
  if (terminal(input.snapshot)) return input.snapshot
  return new Promise<ResponseSnapshot>((resolve, reject) => {
    let current = input.snapshot
    const pending = new Map<number, ResponseEvent>()
    const socket: PulpoSocket = createSocket(input.baseUrl, {
      path: '/socket.io',
      auth: { sessionToken: input.token },
      autoConnect: false,
      reconnection: true,
    })
    let settled = false

    const cleanup = () => {
      socket.removeAllListeners()
      socket.disconnect()
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const finishIfTerminal = () => {
      if (settled || !terminal(current)) return
      settled = true
      cleanup()
      resolve(current)
    }
    const flush = () => {
      for (;;) {
        const event = pending.get(current.sequence + 1)
        if (!event) break
        pending.delete(event.sequence)
        current = applyResponseEventToSnapshot(current, event)
        input.onEvent?.(event)
      }
    }

    socket.on('connect', () => {
      socket.emit('response.subscribe', {
        responseId: current.responseId,
        afterSequence: current.sequence,
      })
    })
    socket.on('connect_error', (error) => fail(new Error(`Realtime connection failed: ${error.message}`)))
    socket.on('response.event', (event) => {
      if (event.responseId !== current.responseId || event.sequence <= current.sequence) return
      pending.set(event.sequence, event)
      flush()
    })
    socket.on('response.snapshot', (snapshot) => {
      if (snapshot.responseId !== current.responseId) return
      current = mergeResponseSnapshots(current, snapshot)
      for (const sequence of pending.keys()) if (sequence <= current.sequence) pending.delete(sequence)
      flush()
      input.onSnapshot?.(current)
      finishIfTerminal()
    })
    socket.connect()
  })
}

function selectionError(lines: string[]): Error {
  return new Error(`Explicit selections are required:\n${lines.map((line) => `  ${line}`).join('\n')}`)
}

/** Parse and validate one explicit public choice ID for every model preset. */
export function resolvePresetSelections(model: TestableModel, values: string[]): Record<string, string> {
  const parsed = new Map<string, string>()
  for (const value of values) {
    const separator = value.indexOf('=')
    if (separator <= 0 || separator === value.length - 1) {
      throw new Error(`Invalid preset selection ${JSON.stringify(value)}; expected <preset-id>=<choice-id>`)
    }
    const presetId = value.slice(0, separator)
    const choiceId = value.slice(separator + 1)
    if (parsed.has(presetId)) throw new Error(`Preset ${presetId} was selected more than once`)
    parsed.set(presetId, choiceId)
  }

  const exposed = new Map(model.presets.map((preset) => [preset.id, preset]))
  const unknown = [...parsed.keys()].filter((presetId) => !exposed.has(presetId))
  if (unknown.length) throw new Error(`Unknown preset${unknown.length === 1 ? '' : 's'} for ${model.id}: ${unknown.join(', ')}`)

  const missing = model.presets.filter((preset) => !parsed.has(preset.id))
  if (missing.length) {
    throw selectionError(missing.map((preset) => (
      `--preset ${preset.id}=<${preset.choices.map((choice) => choice.id).join('|')}>`
    )))
  }

  for (const preset of model.presets) {
    const choiceId = parsed.get(preset.id)!
    if (!preset.choices.some((choice) => choice.id === choiceId)) {
      throw new Error(
        `Unknown choice ${choiceId} for preset ${preset.id}; choose ${preset.choices.map((choice) => choice.id).join(', ')}`,
      )
    }
  }
  return Object.fromEntries(parsed)
}

export async function readModelTestPrompt(io: CliIo, promptParts: string[]): Promise<string> {
  const argument = promptParts.join(' ').trim()
  if (argument) return argument
  if (io.stdin.isTTY) throw new Error('Prompt is required as an argument or on stdin')
  const chunks: Buffer[] = []
  for await (const chunk of io.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const prompt = Buffer.concat(chunks).toString('utf8').trim()
  if (!prompt) throw new Error('Prompt is required as an argument or on stdin')
  return prompt
}

export function responseText(snapshot: ResponseSnapshot): string {
  const parts: string[] = []
  for (const item of snapshot.output) {
    if (!item || typeof item !== 'object') continue
    const content = (item as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const candidate = part as { type?: unknown; text?: unknown }
      if (candidate.type === 'output_text' && typeof candidate.text === 'string') parts.push(candidate.text)
    }
  }
  return parts.join('')
}

function writeJsonLine(output: Writable, value: unknown): void {
  output.write(`${JSON.stringify(value)}\n`)
}

export async function runModelTest(input: {
  client: PulpoManagementClient
  baseUrl: string
  token: string
  model: TestableModel
  prompt: string
  agentMode: boolean
  presetSelections: Record<string, string>
  keep: boolean
  streamText: boolean
  jsonl: boolean
  io: CliIo
  follow?: FollowResponse
}): Promise<ModelTestResult> {
  const chatId = randomUUID()
  const responseId = randomUUID()
  const temporary = !input.keep
  const created = await input.client.request<{ chat: { id: string }; response: ResponseSnapshot }>('/api/chats/start', {
    method: 'POST',
    headers: { 'idempotency-key': responseId },
    body: {
      chat: {
        clientId: chatId,
        modelId: input.model.id,
        title: `CLI test: ${input.model.name}`.slice(0, 200),
        temporary,
      },
      response: {
        clientId: responseId,
        parentResponseId: null,
        input: input.prompt,
        modelId: input.model.id,
        presetSelections: input.presetSelections,
        attachmentIds: [],
        agentMode: input.agentMode,
      },
    },
  })

  let writtenText = ''
  const writeProgress = (snapshot: ResponseSnapshot) => {
    if (!input.streamText) return
    const text = responseText(snapshot)
    if (text.startsWith(writtenText)) {
      input.io.stdout.write(text.slice(writtenText.length))
      writtenText = text
    }
  }
  if (input.jsonl) writeJsonLine(input.io.stdout, { type: 'response.snapshot', chatId: created.chat.id, snapshot: created.response })
  const finalSnapshot = await (input.follow ?? followResponse)({
    baseUrl: input.baseUrl,
    token: input.token,
    snapshot: created.response,
    onEvent: (event) => {
      if (input.jsonl) writeJsonLine(input.io.stdout, { type: 'response.event', chatId: created.chat.id, event })
      if (input.streamText && event.type === 'response.output_text.delta') {
        const delta = (event.payload as { delta?: unknown }).delta
        if (typeof delta === 'string') {
          input.io.stdout.write(delta)
          writtenText += delta
        }
      }
    },
    onSnapshot: (snapshot) => {
      if (input.jsonl) writeJsonLine(input.io.stdout, { type: 'response.snapshot', chatId: created.chat.id, snapshot })
      writeProgress(snapshot)
    },
  })
  writeProgress(finalSnapshot)
  if (input.streamText) input.io.stdout.write('\n')

  return {
    chatId: created.chat.id,
    responseId: finalSnapshot.responseId,
    modelId: input.model.id,
    agentMode: input.agentMode,
    presetSelections: input.presetSelections,
    temporary,
    snapshot: finalSnapshot,
  }
}
