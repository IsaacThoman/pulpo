import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { ChatPreset, ResponseSnapshot } from '@pulpo/contracts'
import { createProgram } from './index.js'
import {
  explicitAgentMode,
  readModelTestPrompt,
  resolvePresetSelections,
  responseText,
  type TestableModel,
} from './model-test.js'

const presets: ChatPreset[] = [
  {
    id: 'reasoning',
    name: 'Reasoning',
    icon: 'brain',
    choices: [
      { id: 'off', displayName: 'Off', action: { type: 'none' } },
      { id: 'high', displayName: 'High', action: { type: 'params', params: { reasoning_effort: 'high' } } },
    ],
  },
  {
    id: 'web-search',
    name: 'Web search',
    icon: 'search',
    choices: [
      { id: 'disabled', displayName: 'Disabled', action: { type: 'none' } },
      { id: 'enabled', displayName: 'Enabled', action: { type: 'none' } },
    ],
  },
]

const model: TestableModel = { id: 'model-1', name: 'Model One', agentEnabled: true, presets }

describe('CLI model testing', () => {
  it('requires one explicit agent mode', () => {
    expect(explicitAgentMode({ agentEnabled: true })).toBe(true)
    expect(explicitAgentMode({ agentDisabled: false })).toBe(false)
    expect(() => explicitAgentMode({})).toThrow('choose --agent or --no-agent')
    expect(() => explicitAgentMode({ agentEnabled: true, agentDisabled: false })).toThrow('choose --agent or --no-agent')
  })

  it('requires and validates every exposed preset', () => {
    expect(resolvePresetSelections(model, ['reasoning=high', 'web-search=disabled'])).toEqual({
      reasoning: 'high',
      'web-search': 'disabled',
    })
    expect(() => resolvePresetSelections(model, ['reasoning=high'])).toThrow('--preset web-search=<disabled|enabled>')
    expect(() => resolvePresetSelections(model, ['reasoning=medium', 'web-search=enabled'])).toThrow('Unknown choice medium')
    expect(() => resolvePresetSelections(model, ['reasoning=off', 'reasoning=high', 'web-search=enabled']))
      .toThrow('selected more than once')
    expect(() => resolvePresetSelections(model, ['reasoning=off', 'web-search=enabled', 'hidden=yes']))
      .toThrow('Unknown preset')
  })

  it('reads a prompt from stdin when no argument is provided', async () => {
    const stdin = new PassThrough()
    stdin.end('Test from a pipeline\n')
    await expect(readModelTestPrompt({ stdin: stdin as never, stdout: new PassThrough(), stderr: new PassThrough() }, []))
      .resolves.toBe('Test from a pipeline')
  })

  it('extracts assistant output text from a snapshot', () => {
    const snapshot: ResponseSnapshot = {
      responseId: 'response-1', status: 'completed', sequence: 2, usage: null, error: null,
      updatedAt: '2026-08-10T00:00:00.000Z',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello ' }, { type: 'output_text', text: 'world' }] }],
    }
    expect(responseText(snapshot)).toBe('Hello world')
  })

  it('starts a temporary test chat with explicit options and emits stable JSON', async () => {
    const previous = { url: process.env.PULPO_URL, token: process.env.PULPO_TOKEN }
    process.env.PULPO_URL = 'https://pulpo.example.test'
    process.env.PULPO_TOKEN = 's'.repeat(48)
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const requests: Array<{ path: string; options?: { body?: unknown } }> = []
    const client = {
      info: async () => ({ managementApiVersion: 1, capabilities: ['catalog'] }),
      request: async (path: string, options?: { body?: unknown }) => {
        requests.push({ path, options })
        if (path === '/api/models') return { agentAvailable: true, data: [model] }
        if (path === '/api/chats/start') {
          const body = options?.body as { chat: { clientId: string }; response: { clientId: string } }
          return {
            chat: { id: body.chat.clientId },
            response: {
              responseId: body.response.clientId, status: 'queued', sequence: 0, output: [], usage: null, error: null,
              updatedAt: '2026-08-10T00:00:00.000Z',
            },
          }
        }
        throw new Error(`Unexpected request: ${path}`)
      },
    }
    try {
      const program = createProgram(
        { stdin: new PassThrough() as never, stdout, stderr },
        {
          createClient: () => client as never,
          followResponse: async ({ snapshot }) => ({
            ...snapshot,
            status: 'completed',
            sequence: 1,
            output: [{ type: 'message', content: [{ type: 'output_text', text: 'It works.' }] }],
          }),
        },
      )
      await program.parseAsync([
        'node', 'pulpo', 'model', 'test', 'model-1', 'Run', 'a', 'test',
        '--no-agent', '--preset', 'reasoning=high', '--preset', 'web-search=disabled', '--json',
      ])
      const output = JSON.parse(stdout.read().toString()) as {
        modelId: string
        agentMode: boolean
        temporary: boolean
        presetSelections: Record<string, string>
        snapshot: ResponseSnapshot
      }
      expect(output).toMatchObject({
        modelId: 'model-1', agentMode: false, temporary: true,
        presetSelections: { reasoning: 'high', 'web-search': 'disabled' },
        snapshot: { status: 'completed' },
      })
      expect(requests.map(({ path }) => path)).toEqual([
        '/api/models', '/api/chats/start',
      ])
      expect(requests.at(-1)?.options?.body).toMatchObject({
        chat: { modelId: 'model-1', temporary: true },
        response: {
          input: 'Run a test', modelId: 'model-1', agentMode: false,
          presetSelections: { reasoning: 'high', 'web-search': 'disabled' },
        },
      })
    } finally {
      if (previous.url === undefined) delete process.env.PULPO_URL
      else process.env.PULPO_URL = previous.url
      if (previous.token === undefined) delete process.env.PULPO_TOKEN
      else process.env.PULPO_TOKEN = previous.token
    }
  })
})
