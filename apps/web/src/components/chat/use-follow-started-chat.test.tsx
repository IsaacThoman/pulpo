// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { webChatStarted } from '@/lib/chat-started'
import { useFollowStartedChat } from './use-follow-started-chat'

const state = vi.hoisted(() => ({ userId: 'account', enabled: true, instance: 'instance', busy: false }))
vi.mock('@/stores/auth', () => ({ useAuth: { getState: () => ({ user: { id: state.userId } }) } }))
vi.mock('@/stores/settings', () => ({ useSettings: { getState: () => ({ composerSyncEnabled: state.enabled }) } }))
vi.mock('@/lib/local-first/database', () => ({ localAccountKey: (id: string) => `${state.instance}|${id}` }))
let path: string
let go: ReturnType<typeof useNavigate>
let sequence = 0
function Composer({ temporary = false, syncEnabled = true }: { temporary?: boolean; syncEnabled?: boolean }) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  path = useLocation().pathname
  go = useNavigate()
  useFollowStartedChat({ userId: state.userId, chatId: path.startsWith('/c/') ? path.slice(3) : null,
    textarea, syncEnabled, temporary, busy: () => state.busy })
  return <textarea ref={textarea} />
}
function mount(props = {}, initial = '/') {
  return render(<MemoryRouter initialEntries={[initial]}><Composer {...props} /></MemoryRouter>)
}
function receive(chatId = `chat-${++sequence}`, scope = 'instance|account') {
  act(() => webChatStarted.receive(scope, { chatId, responseId: `response:${chatId}` }))
  return chatId
}
beforeEach(() => {
  Object.assign(state, { userId: 'account', enabled: true, instance: 'instance', busy: false })
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('follows from the focused input and claims competing starts before rendering', () => {
  const view = mount()
  const input = view.getByRole('textbox') as HTMLTextAreaElement
  input.focus()
  act(() => {
    webChatStarted.receive('instance|account', { chatId: 'winner', responseId: 'response' })
    webChatStarted.receive('instance|account', { chatId: 'loser', responseId: 'response-2' })
  })
  expect(path).toBe('/c/winner')
  expect(document.activeElement).toBe(input)
})

it.each(['blur', 'hidden', 'window-blur', 'temporary', 'opt-out', 'admin', 'existing-chat', 'other-page', 'busy', 'account-switch', 'instance-switch'])(
  'does not follow or defer navigation when ineligible: %s', (reason) => {
    const view = mount({ temporary: reason === 'temporary', syncEnabled: reason !== 'admin' },
      reason === 'existing-chat' ? '/c/existing' : reason === 'other-page' ? '/settings' : '/')
    const initial = path
    const input = view.getByRole('textbox') as HTMLTextAreaElement
    input.focus()
    if (reason === 'blur') input.blur()
    if (reason === 'hidden') vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    if (reason === 'window-blur') vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    if (reason === 'opt-out') state.enabled = false
    if (reason === 'busy') state.busy = true
    if (reason === 'account-switch') state.userId = 'other'
    if (reason === 'instance-switch') state.instance = 'other'
    receive()
    input.focus()
    expect(path).toBe(initial)
  },
)

it('ignores local sends and events discarded before focus, then accepts a fresh start', () => {
  const view = mount(), id = `discarded-${++sequence}`
  receive(id)
  view.getByRole('textbox').focus()
  receive(id)
  const local = `local-${++sequence}`
  webChatStarted.ignoreLocal('instance|account', local)
  receive(local)
  expect(path).toBe('/')
  const fresh = receive()
  expect(path).toBe(`/c/${fresh}`)
  act(() => go('/'))
  view.getByRole('textbox').focus()
  receive(fresh)
  expect(path).toBe('/')
})
