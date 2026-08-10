import { describe, expect, it } from 'vitest'
import {
  applyResponseEventToSnapshot,
  adminUsageEventSchema,
  authSettingsSchema,
  chatSummarySchema,
  CHAT_PRESET_ICON_NAMES,
  chatPresetsSchema,
  catalogIconReferenceSchema,
  createModelSchema,
  createChatResponseSchema,
  DEFAULT_OCR_SYSTEM_PROMPT,
  mergeResponseSnapshots,
  managementInfoSchema,
  managementSettingsDocumentSchema,
  managementTokenSchema,
  isChatPresetIcon,
  createManagementTokenSchema,
  mobileConfigSchema,
  modelPreferencesPatchSchema,
  modelPreferencesSchema,
  nativeLoginInputSchema,
  ocrSettingsSchema,
  persistChatResponseSchema,
  responseEventSchema,
  startChatSchema,
  syncRequestSchema,
  type ResponseEvent,
  type ResponseSnapshot,
} from './index.js'

const streamingSnapshot: ResponseSnapshot = {
  responseId: '00000000-0000-4000-8000-000000000001',
  status: 'in_progress',
  sequence: 0,
  output: [],
  usage: null,
  error: null,
  updatedAt: '2026-07-31T00:00:00.000Z',
}

function delta(type: string, text: string, sequence: number): ResponseEvent {
  return {
    responseId: streamingSnapshot.responseId,
    sequence,
    type,
    payload: { delta: text },
    emittedAt: `2026-07-31T00:00:0${sequence}.000Z`,
  }
}

function targetedDelta(type: string, text: string, sequence: number, itemId: string): ResponseEvent {
  return { ...delta(type, text, sequence), payload: { delta: text, item_id: itemId } }
}

describe('shared contracts', () => {
  it('defaults missing in-flight response ids in chat summaries', () => {
    const summary = {
      id: crypto.randomUUID(),
      title: 'Active chat',
      modelId: 'model',
      pinned: false,
      folderId: null,
      temporary: false,
      updatedAt: '2026-08-05T00:00:00.000Z',
      activeResponseId: null,
    }
    expect(chatSummarySchema.parse(summary).inFlightResponseIds).toEqual([])

    const responseId = crypto.randomUUID()
    expect(chatSummarySchema.parse({ ...summary, inFlightResponseIds: [responseId] }).inFlightResponseIds)
      .toEqual([responseId])
  })

  it('requires persisted chat responses to clear temporary retention', () => {
    const summary = {
      id: crypto.randomUUID(),
      title: 'Saved chat',
      modelId: 'model',
      pinned: false,
      folderId: null,
      temporary: false,
      expiresAt: null,
      updatedAt: '2026-08-05T00:00:00.000Z',
      activeResponseId: null,
    }
    expect(persistChatResponseSchema.parse(summary)).toMatchObject({ temporary: false, expiresAt: null })
    expect(() => persistChatResponseSchema.parse({ ...summary, temporary: true })).toThrow()
  })

  it('uses the Pulpo Proxy OCR prompt by default', () => {
    expect(ocrSettingsSchema.parse({}).systemPrompt).toBe(DEFAULT_OCR_SYSTEM_PROMPT)
  })

  it('allows attachment limits up to 1,000 MiB', () => {
    expect(authSettingsSchema.parse({ maxAttachmentBytes: 1_000 * 1024 * 1024 }).maxAttachmentBytes)
      .toBe(1_000 * 1024 * 1024)
    expect(authSettingsSchema.safeParse({ maxAttachmentBytes: 1_000 * 1024 * 1024 + 1 }).success).toBe(false)
  })

  it('defaults and validates per-model compaction policy', () => {
    const policy = createModelSchema.pick({
      compactionEnabled: true,
      compactionThresholdTokens: true,
      agentCompactionThresholdTokens: true,
      compactionRetainedTurns: true,
    })
    expect(policy.parse({})).toEqual({
      compactionEnabled: true,
      compactionThresholdTokens: 100_000,
      agentCompactionThresholdTokens: 180_000,
      compactionRetainedTurns: 4,
    })
    expect(policy.safeParse({ compactionThresholdTokens: 1_999 }).success).toBe(false)
    expect(policy.safeParse({ agentCompactionThresholdTokens: 1_000_001 }).success).toBe(false)
    expect(policy.safeParse({ compactionRetainedTurns: 33 }).success).toBe(false)
  })

  it('validates additive custom catalog icon references', () => {
    const icon = {
      id: '00000000-0000-7000-8000-000000000010', mode: 'monochrome',
      lightUrl: '/api/catalog-icons/00000000-0000-7000-8000-000000000010/monochrome-light.png',
      darkUrl: '/api/catalog-icons/00000000-0000-7000-8000-000000000010/monochrome-dark.png',
    }
    expect(catalogIconReferenceSchema.parse(icon)).toEqual(icon)
    expect(catalogIconReferenceSchema.safeParse({ ...icon, lightUrl: 'https://example.com/icon.png' }).success).toBe(false)
  })

  it('rejects response events without a positive sequence', () => {
    const result = responseEventSchema.safeParse({
      responseId: crypto.randomUUID(),
      sequence: 0,
      type: 'response.created',
      payload: {},
      emittedAt: new Date().toISOString(),
    })
    expect(result.success).toBe(false)
  })

  it('accepts per-response synchronization cursors', () => {
    const responseId = crypto.randomUUID()
    const result = syncRequestSchema.parse({
      tabId: 'tab-1',
      accountRevision: 3,
      responseCursors: { [responseId]: 42 },
    })
    expect(result.responseCursors[responseId]).toBe(42)
  })

  it('accepts generic composer presets', () => {
    const presets = chatPresetsSchema.parse([{
      id: 'reasoning', name: 'Reasoning', icon: 'brain', defaultChoiceId: 'medium',
      choices: [
        { id: 'off', displayName: 'Off', action: { type: 'none' } },
        { id: 'medium', displayName: 'Medium', icon: 'sparkles', action: { type: 'params', params: { reasoning_effort: 'medium' } } },
      ],
    }])
    expect(presets[0]?.defaultChoiceId).toBe('medium')
  })

  it('accepts every canonical Lucide preset icon and rejects unknown names', () => {
    const presets = chatPresetsSchema.parse([{
      id: 'media', name: 'Media', icon: 'camera',
      choices: [{ id: 'chart', displayName: 'Chart', icon: 'chart-no-axes-column', action: { type: 'none' } }],
    }])
    expect(presets[0]?.icon).toBe('camera')
    expect(isChatPresetIcon('scan-qr-code')).toBe(true)
    expect(isChatPresetIcon('alarm-check')).toBe(false)
    expect(chatPresetsSchema.safeParse([{
      id: 'bad', name: 'Bad', icon: 'not-a-lucide-icon', choices: [{ id: 'on', displayName: 'On', action: { type: 'none' } }],
    }]).error?.issues[0]?.message).toContain('pulpo model icons')
  })

  it('keeps the generated preset icon catalog sorted, unique, and backwards compatible', () => {
    expect(CHAT_PRESET_ICON_NAMES).toEqual([...CHAT_PRESET_ICON_NAMES].sort((left, right) => left.localeCompare(right)))
    expect(new Set(CHAT_PRESET_ICON_NAMES).size).toBe(CHAT_PRESET_ICON_NAMES.length)
    expect(CHAT_PRESET_ICON_NAMES).toEqual(expect.arrayContaining([
      'brain', 'zap', 'zap-off', 'gauge', 'sparkles', 'rocket', 'circle', 'flame', 'timer',
    ]))
  })

  it('normalizes ordered account model preferences', () => {
    expect(modelPreferencesSchema.parse({
      favoriteModelIds: ['model-b', 'model-a', 'model-b'],
      providerOrder: ['lab-two', 'lab-one', 'lab-two'],
    })).toEqual({
      favoriteModelIds: ['model-b', 'model-a'],
      providerOrder: ['lab-two', 'lab-one'],
    })
    expect(modelPreferencesSchema.parse({})).toEqual({ favoriteModelIds: [], providerOrder: [] })
    expect(modelPreferencesPatchSchema.safeParse({ favoriteModelIds: [42] }).success).toBe(false)
    expect(modelPreferencesPatchSchema.safeParse({ providerOrder: Array.from({ length: 501 }, (_, index) => `lab-${index}`) }).success).toBe(false)
  })

  it('normalizes new-account model defaults while preserving favorite order', () => {
    expect(authSettingsSchema.parse({}).newAccountModelDefaults).toEqual({
      defaultModelId: null,
      favoriteModelIds: [],
    })
    expect(authSettingsSchema.parse({
      newAccountModelDefaults: {
        defaultModelId: ' model-a ',
        favoriteModelIds: ['model-b', 'model-a', 'model-b'],
      },
    }).newAccountModelDefaults).toEqual({
      defaultModelId: 'model-a',
      favoriteModelIds: ['model-b', 'model-a'],
    })
  })

  it('validates native sessions and instance discovery', () => {
    expect(nativeLoginInputSchema.parse({
      email: 'member@example.com', password: 'password', deviceLabel: 'Isaac’s iPhone',
    }).deviceLabel).toBe('Isaac’s iPhone')
    expect(mobileConfigSchema.safeParse({
      mobileApiVersion: 1,
      instance: { name: 'Pulpo', version: '1.0.0', publicUrl: 'https://pulpo.baby' },
      setupRequired: false,
      auth: { signupEnabled: true, pendingDetails: true, adminEmail: '', pendingMessage: 'Pending' },
      capabilities: {
        bearerSessions: true, realtime: true, chatDuplication: true,
        publicSharing: true, attachments: true, folders: true,
      },
    }).success).toBe(true)
    expect(nativeLoginInputSchema.parse({
      email: 'member@example.com', password: 'password', deviceLabel: 'Pulpo CLI', twoFactorCode: '123456',
    }).twoFactorCode).toBe('123456')
    expect(mobileConfigSchema.parse({
      mobileApiVersion: 1,
      instance: { name: 'Pulpo', version: '1.0.0', publicUrl: 'https://pulpo.baby' },
      setupRequired: false,
      auth: { signupEnabled: true, pendingDetails: true, adminEmail: '', pendingMessage: 'Pending' },
      capabilities: {
        bearerSessions: true, realtime: true, chatDuplication: true,
        publicSharing: true, attachments: true, folders: true,
      },
    })).toMatchObject({
      limits: { maxAttachmentBytes: 25 * 1024 * 1024 },
      capabilities: { twoFactorAuth: false },
    })
  })

  it('normalizes a complete management settings document', () => {
    const document = managementSettingsDocumentSchema.parse({
      apiVersion: 'pulpo.dev/management/v1',
      kind: 'Settings',
      revision: 'revision-1',
      account: {},
      instance: {},
    })
    expect(document.account).toMatchObject({ theme: 'system', trashRetention: '30d', favoriteModelIds: [] })
    expect(document.instance).toMatchObject({
      auth: {
        signupEnabled: true,
        newAccountModelDefaults: { defaultModelId: null, favoriteModelIds: [] },
      },
      interface: { localTask: 'current' },
      ocr: { enabled: false, modelId: null },
      webTools: { searchEnabled: false },
      logging: { payloadRetention: '7d' },
    })
  })

  it('bounds management tokens and secret references', () => {
    expect(createManagementTokenSchema.parse({ name: 'automation', scopes: ['instance:read', 'instance:read'] }))
      .toMatchObject({ scopes: ['instance:read'], expiresInDays: 90 })
    expect(createManagementTokenSchema.safeParse({ name: 'too long', scopes: ['instance:read'], expiresInDays: 366 }).success).toBe(false)
    expect(managementSettingsDocumentSchema.safeParse({
      apiVersion: 'pulpo.dev/management/v1', kind: 'Settings', revision: 'revision', account: {},
      instance: { webTools: { apiKey: { fromEnv: 'PULPO_KAGI_KEY' } } },
    }).success).toBe(true)
  })

  it('validates public management metadata and redacted token rows', () => {
    expect(managementInfoSchema.safeParse({
      managementApiVersion: 1,
      instance: { name: 'Pulpo', version: '1.0.0', publicUrl: 'https://pulpo.example.com' },
      deployment: {
        storageDriver: 's3', databaseConfigured: true, redisConfigured: true, s3Configured: true,
        encryptionConfigured: true, cookieSecure: true, smtpConfigured: true, workspaceControllerConfigured: false,
      },
      capabilities: ['settings'],
    }).success).toBe(true)
    expect(managementTokenSchema.safeParse({
      id: crypto.randomUUID(), name: 'CI', prefix: 'mt-pulpo-prefix', scopes: ['instance:read'],
      expiresAt: new Date().toISOString(), lastUsedAt: null, revokedAt: null, createdAt: new Date().toISOString(),
    }).success).toBe(true)
  })

  it('tracks agent turns separately from retry attempts', () => {
    const event = adminUsageEventSchema.parse({
      requestId: crypto.randomUUID(),
      responseId: crypto.randomUUID(),
      status: 'in_progress',
      elapsedMs: 1_000,
      currentModelId: 'kimi-k3',
      retryAttempt: 1,
      turnNumber: 5,
      retryCount: 0,
      fallbackUsed: false,
      ocrStatus: 'not_requested',
      eventCount: 5,
      inputTokens: 100,
      outputTokens: 50,
      updatedAt: new Date().toISOString(),
    })

    expect(event).toMatchObject({ retryAttempt: 1, turnNumber: 5, retryCount: 0 })
  })

  it.each([
    { name: 'malformed IDs', value: [{ id: 'Not Valid', name: 'Reasoning', icon: 'brain', choices: [{ id: 'on', displayName: 'On', action: { type: 'none' } }] }] },
    { name: 'empty choices', value: [{ id: 'reasoning', name: 'Reasoning', icon: 'brain', choices: [] }] },
    { name: 'invalid defaults', value: [{ id: 'reasoning', name: 'Reasoning', icon: 'brain', defaultChoiceId: 'missing', choices: [{ id: 'on', displayName: 'On', action: { type: 'none' } }] }] },
    { name: 'unsupported actions', value: [{ id: 'reasoning', name: 'Reasoning', icon: 'brain', choices: [{ id: 'on', displayName: 'On', action: { type: 'script' } }] }] },
    { name: 'duplicate preset IDs', value: [
      { id: 'style', name: 'Style', icon: 'sparkles', choices: [{ id: 'a', displayName: 'A', action: { type: 'none' } }] },
      { id: 'style', name: 'Style again', icon: 'sparkles', choices: [{ id: 'b', displayName: 'B', action: { type: 'none' } }] },
    ] },
    { name: 'too many choices', value: [{ id: 'style', name: 'Style', icon: 'sparkles', choices: Array.from({ length: 21 }, (_, index) => ({ id: `choice-${index}`, displayName: `Choice ${index}`, action: { type: 'none' } })) }] },
  ])('rejects $name', ({ value }) => {
    expect(chatPresetsSchema.safeParse(value).success).toBe(false)
  })
})

describe('response snapshot accumulation', () => {
  it('does not lose text across active snapshots without output', () => {
    const first = applyResponseEventToSnapshot(streamingSnapshot, delta('response.output_text.delta', 'chunk A', 1))
    const checkpoint = mergeResponseSnapshots(first, { ...streamingSnapshot, sequence: 2 })
    const second = applyResponseEventToSnapshot(checkpoint, delta('response.output_text.delta', ' chunk B', 3))
    const nextCheckpoint = mergeResponseSnapshots(second, { ...streamingSnapshot, sequence: 4 })
    const third = applyResponseEventToSnapshot(nextCheckpoint, delta('response.output_text.delta', ' chunk C', 5))

    expect(third.output).toMatchObject([{ content: [{ text: 'chunk A chunk B chunk C' }] }])
  })

  it('keeps snapshots and events monotonic by sequence', () => {
    const current = applyResponseEventToSnapshot(streamingSnapshot, delta('response.output_text.delta', 'current', 3))
    const duplicate = applyResponseEventToSnapshot(current, delta('response.output_text.delta', ' duplicate', 3))
    const older = mergeResponseSnapshots(current, { ...streamingSnapshot, sequence: 2 })

    expect(duplicate).toBe(current)
    expect(older).toBe(current)
  })

  it('uses snapshot time and terminal status to order equal event sequences', () => {
    const current = { ...streamingSnapshot, sequence: 3, updatedAt: '2026-07-31T00:00:03.000Z' }
    const stale = { ...current, updatedAt: '2026-07-31T00:00:02.000Z', output: [{ stale: true }] }
    const terminal = { ...stale, status: 'completed' as const }

    expect(mergeResponseSnapshots(current, stale)).toBe(current)
    expect(mergeResponseSnapshots(current, terminal)).toBe(terminal)
    expect(mergeResponseSnapshots(terminal, current)).toBe(terminal)
  })

  it('upgrades equal-version empty output without allowing a later downgrade', () => {
    const empty = {
      ...streamingSnapshot,
      status: 'completed' as const,
      sequence: 3,
      output: [],
      updatedAt: '2026-07-31T00:00:03.000Z',
    }
    const full = { ...empty, output: [{ type: 'message', content: [{ text: 'Fetched branch' }] }] }
    const newerEmpty = { ...empty, updatedAt: '2026-07-31T00:00:04.000Z' }

    expect(mergeResponseSnapshots(empty, full)).toBe(full)
    expect(mergeResponseSnapshots(full, empty)).toBe(full)
    expect(mergeResponseSnapshots(full, newerEmpty)).toEqual({ ...newerEmpty, output: full.output })
  })

  it('keeps reasoning separate from assistant output', () => {
    const reasoned = applyResponseEventToSnapshot(streamingSnapshot, delta('response.reasoning_summary_text.delta', 'Think', 1))
    const answered = applyResponseEventToSnapshot(reasoned, delta('response.output_text.delta', 'Answer', 2))

    expect(answered.output).toMatchObject([
      { type: 'reasoning', summary: [{ text: 'Think' }] },
      { type: 'message', content: [{ text: 'Answer' }] },
    ])
  })

  it('projects agent tool, workspace, compaction, and attachment events without a full snapshot', () => {
    const responseId = streamingSnapshot.responseId
    const event = (sequence: number, type: string, payload: Record<string, unknown>) => ({
      responseId, sequence, type, payload, emittedAt: `2026-08-01T00:00:0${sequence}.000Z`,
    })
    const events = [
      event(1, 'pulpo.agent.workspace.waiting', { id: 'workspace-1', type: 'pulpo_workspace', state: 'waiting' }),
      event(2, 'pulpo.agent.tool.queued', { id: 'tool-1', type: 'pulpo_tool', tool: 'web_search', arguments: { query: 'x' }, status: 'queued', output: '' }),
      event(3, 'pulpo.agent.tool.started', { id: 'tool-1', type: 'pulpo_tool', status: 'running', startedAt: '2026-08-01T00:00:03.000Z' }),
      event(4, 'pulpo.agent.tool.delta', { id: 'tool-1', delta: 'partial result' }),
      event(5, 'pulpo.agent.tool.completed', { id: 'tool-1', output: 'final result', isError: false, durationMs: 10 }),
      event(6, 'pulpo.compaction.updated', { id: 'compact-1', type: 'pulpo_compaction', status: 'completed', summary: 'summary' }),
      event(7, 'pulpo.agent.attachment.created', { type: 'pulpo_attachment', attachment_id: 'file-1', name: 'result.txt' }),
    ]
    const result = events.reduce(applyResponseEventToSnapshot, streamingSnapshot)

    expect(result.output).toMatchObject([
      { type: 'pulpo_workspace', state: 'waiting' },
      { id: 'tool-1', tool: 'web_search', status: 'completed', output: 'final result' },
      { id: 'compact-1', summary: 'summary' },
      { type: 'pulpo_attachment', attachment_id: 'file-1' },
    ])
    expect(result.sequence).toBe(7)
  })

  it('accepts terminal output as authoritative', () => {
    const provisional = applyResponseEventToSnapshot(streamingSnapshot, delta('response.output_text.delta', 'partial', 1))
    const terminal = mergeResponseSnapshots(provisional, {
      ...streamingSnapshot,
      status: 'completed',
      sequence: 2,
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'final answer' }] }],
    })

    expect(terminal.status).toBe('completed')
    expect(terminal.output).toMatchObject([{ content: [{ text: 'final answer' }] }])
  })

  it('applies agent deltas to the targeted turn instead of the first output item', () => {
    const snapshot = {
      ...streamingSnapshot,
      sequence: 4,
      output: [
        { id: 'agent:1:0:message', type: 'message', status: 'completed', content: [{ type: 'output_text', text: 'First turn' }] },
        { id: 'tool-1', type: 'pulpo_tool', status: 'completed' },
        { id: 'agent:2:0:message', type: 'message', status: 'in_progress', content: [{ type: 'output_text', text: 'Second' }] },
      ],
    }
    const result = applyResponseEventToSnapshot(
      snapshot,
      targetedDelta('response.output_text.delta', ' turn', 5, 'agent:2:0:message'),
    )

    expect(result.output).toMatchObject([
      { id: 'agent:1:0:message', content: [{ text: 'First turn' }] },
      { id: 'tool-1' },
      { id: 'agent:2:0:message', content: [{ text: 'Second turn' }] },
    ])
  })

  it('starts a distinct message when the first delta for a new agent turn precedes its snapshot', () => {
    const snapshot = {
      ...streamingSnapshot,
      sequence: 4,
      output: [
        {
          id: 'agent:1:0:message',
          type: 'message',
          status: 'in_progress',
          content: [{ type: 'output_text', text: 'First turn' }],
        },
        { id: 'tool-1', type: 'pulpo_tool', status: 'completed' },
      ],
    }

    const started = applyResponseEventToSnapshot(
      snapshot,
      targetedDelta('response.output_text.delta', 'Second', 5, 'agent:2:0:message'),
    )
    const continued = applyResponseEventToSnapshot(
      started,
      targetedDelta('response.output_text.delta', ' turn', 6, 'agent:2:0:message'),
    )

    expect(continued.output).toMatchObject([
      { id: 'agent:1:0:message', content: [{ text: 'First turn' }] },
      { id: 'tool-1' },
      { id: 'agent:2:0:message', content: [{ text: 'Second turn' }] },
    ])
  })

  it('starts distinct reasoning when a targeted reasoning item has not been checkpointed yet', () => {
    const snapshot = {
      ...streamingSnapshot,
      sequence: 7,
      output: [{
        id: 'agent:1:0:reasoning',
        type: 'reasoning',
        status: 'in_progress',
        summary: [{ type: 'summary_text', text: 'First thought' }],
      }],
    }
    const result = applyResponseEventToSnapshot(
      snapshot,
      targetedDelta('response.reasoning_summary_text.delta', 'Next thought', 8, 'agent:2:0:reasoning'),
    )

    expect(result.output).toMatchObject([
      { id: 'agent:1:0:reasoning', summary: [{ text: 'First thought' }] },
      { id: 'agent:2:0:reasoning', summary: [{ text: 'Next thought' }] },
    ])
  })

  it('accepts an explicit branch parent for follow-up generation', () => {
    const parentResponseId = '00000000-0000-4000-8000-000000000002'
    const parsed = createChatResponseSchema.parse({
      parentResponseId,
      input: 'Follow this branch',
      modelId: 'model',
    })

    expect(parsed.parentResponseId).toBe(parentResponseId)
  })

  it('requires stable chat and response IDs for atomic chat startup', () => {
    const chatId = '00000000-0000-4000-8000-000000000002'
    const responseId = '00000000-0000-4000-8000-000000000003'
    expect(startChatSchema.parse({
      chat: { clientId: chatId, modelId: 'model-1', title: 'Hello' },
      response: { clientId: responseId, input: 'Hello', modelId: 'model-1' },
    })).toMatchObject({ chat: { clientId: chatId }, response: { clientId: responseId } })
    expect(() => startChatSchema.parse({
      chat: { modelId: 'model-1' },
      response: { clientId: responseId, input: 'Hello', modelId: 'model-1' },
    })).toThrow()
  })

  it('validates queued messages and queue edit actions', async () => {
    const { createQueuedMessageSchema, updateQueuedMessageSchema } = await import('./index.js')
    const attachmentId = '00000000-0000-4000-8000-000000000004'
    expect(createQueuedMessageSchema.parse({
      input: '', modelId: 'model-1', attachmentIds: [attachmentId], agentMode: true,
    })).toMatchObject({ attachmentIds: [attachmentId], agentMode: true })
    expect(updateQueuedMessageSchema.parse({
      action: 'save_edit', input: 'updated', modelId: 'model-2',
    })).toMatchObject({ action: 'save_edit', input: 'updated', attachmentIds: [] })
    expect(() => createQueuedMessageSchema.parse({ input: '', modelId: 'model-1' })).toThrow()
    expect(() => updateQueuedMessageSchema.parse({ action: 'save_edit', input: '', modelId: 'model-1' })).toThrow()
  })

  it('accepts attachment-aware message edits and rejects duplicate references', async () => {
    const { editMessageSchema } = await import('./index.js')
    const attachmentId = '00000000-0000-4000-8000-000000000004'

    expect(editMessageSchema.parse({
      content: '', attachmentIds: [attachmentId], agentMode: true,
    })).toMatchObject({ attachmentIds: [attachmentId], agentMode: true })
    expect(editMessageSchema.parse({ content: 'legacy client' })).toEqual({ content: 'legacy client' })
    expect(() => editMessageSchema.parse({
      content: 'duplicate', attachmentIds: [attachmentId, attachmentId],
    })).toThrow(/unique/i)
  })

})
