// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useFollowStartedChat } from './useFollowStartedChat'
import { mobileChatStarted } from './chatStarted'

const state = vi.hoisted(() => ({ foreground: 'active', focused: true, busy: false, enabled: true,
  userId: 'account', instance: 'instance', status: 'authenticated' }))
vi.mock('react-native', () => ({ AppState: { get currentState() { return state.foreground } } }))
vi.mock('../../store/session', () => ({ useSessionStore: { getState: () => ({ user: { id: state.userId }, instanceUrl: state.instance, status: state.status }) } }))
vi.mock('../../store/preferences', () => ({ usePreferencesStore: { getState: () => ({ composerSyncEnabled: state.enabled }) } }))
vi.mock('../../data/database', () => ({ cacheNamespace: (instance: string, id: string) => `${instance}|${id}` }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
let root: Root
let sequence = 0
const open = vi.fn()
type Props = { chatId?: string; screenFocused?: boolean; temporary?: boolean }
function Composer({ chatId, screenFocused = true, temporary = false }: Props) {
  useFollowStartedChat({ namespace: 'instance|account', chatId: chatId ?? null, screenFocused, temporary,
    textarea: { current: { isFocused: () => state.focused } } as Parameters<typeof useFollowStartedChat>[0]['textarea'],
    busy: () => state.busy, open })
  return null
}
async function mount(props: Props = {}) { await act(async () => root.render(<Composer {...props} />)) }
function receive(chatId = `chat-${++sequence}`) {
  mobileChatStarted.receive('instance|account', { chatId, responseId: `response:${chatId}` })
  return chatId
}
beforeEach(() => {
  Object.assign(state, { foreground: 'active', focused: true, busy: false, enabled: true,
    userId: 'account', instance: 'instance', status: 'authenticated' })
  open.mockClear()
  root = createRoot(document.createElement('div'))
})
afterEach(async () => { await act(async () => root.unmount()) })

it('follows immediately without blurring the input, and claims concurrent starts', async () => {
  await mount()
  const id = receive()
  receive()
  expect(open.mock.calls).toEqual([[id]])
  expect(state.focused).toBe(true)
})
it.each(['blur', 'background', 'inactive', 'screen-blur', 'temporary', 'opt-out', 'existing', 'sending', 'account-switch', 'instance-switch', 'logout'])(
  'does not follow or defer ineligible events: %s', async (reason) => {
    await mount({ chatId: reason === 'existing' ? 'existing' : undefined, screenFocused: reason !== 'screen-blur', temporary: reason === 'temporary' })
    if (reason === 'blur') state.focused = false
    if (reason === 'background' || reason === 'inactive') state.foreground = reason
    if (reason === 'opt-out') state.enabled = false
    if (reason === 'sending') state.busy = true
    if (reason === 'account-switch') state.userId = 'other'
    if (reason === 'instance-switch') state.instance = 'other'
    if (reason === 'logout') state.status = 'anonymous'
    const id = receive()
    state.foreground = 'active'; state.focused = true
    receive(id)
    expect(open).not.toHaveBeenCalled()
  },
)
it('ignores local starts after returning to a new chat and only follows fresh remote events', async () => {
  await mount({ chatId: 'old' })
  const local = `local-${++sequence}`
  mobileChatStarted.ignoreLocal('instance|account', local)
  await mount()
  receive(local)
  expect(open).not.toHaveBeenCalled()
  const remote = receive()
  expect(open).toHaveBeenCalledWith(remote)
})
