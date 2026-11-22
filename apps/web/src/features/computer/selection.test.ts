import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chooseComputer, computerChoice, computerSelectionStorageKey, DEFAULT_COMPUTER_CHOICE, keepComputerChoice,
  parseComputerChoices, resetComputerChoicesForTests, subscribeComputerChoices, type ComputerChoice,
} from './selection'

const storage = new Map<string, string>()
const localStorageStub = {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { storage.set(key, value) }),
  removeItem: (key: string) => { storage.delete(key) },
}

const owner = 'https://pulpo.example|user-1'
const project = { path: '/Users/me/project', name: 'project' }
const full: ComputerChoice = { enabled: true, access: 'full', folder: null }
const suggest: ComputerChoice = { enabled: true, access: 'suggest', folder: project }

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('localStorage', localStorageStub)
  resetComputerChoicesForTests()
})
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('computer selection', () => {
  it('starts on Cloud', () => {
    expect(computerChoice(owner, null)).toEqual(DEFAULT_COMPUTER_CHOICE)
    expect(computerChoice(owner, 'chat-a')).toEqual(DEFAULT_COMPUTER_CHOICE)
  })

  it('starts new chats from the last choice, while a chat keeps its own', () => {
    chooseComputer(owner, 'chat-a', suggest)
    expect(computerChoice(owner, 'chat-a')).toEqual(suggest)
    expect(computerChoice(owner, null)).toEqual(suggest)
    expect(computerChoice(owner, 'chat-b')).toEqual(suggest)

    chooseComputer(owner, null, full)
    expect(computerChoice(owner, 'chat-a')).toEqual(suggest)
    expect(computerChoice(owner, 'chat-b')).toEqual(full)

    // A chat that was sent with a choice keeps it; one with its own is left alone.
    keepComputerChoice(owner, 'chat-b', full)
    keepComputerChoice(owner, 'chat-a', full)
    chooseComputer(owner, null, { ...full, enabled: false })
    expect(computerChoice(owner, 'chat-b')).toEqual(full)
    expect(computerChoice(owner, 'chat-a')).toEqual(suggest)
  })

  it('persists per instance and account', () => {
    chooseComputer(owner, 'chat-a', suggest)
    expect(computerSelectionStorageKey(owner)).toBe('pulpo.computer.selection:https://pulpo.example|user-1')
    expect(JSON.parse(storage.get(computerSelectionStorageKey(owner))!)).toEqual({ v: 1, last: suggest, chats: { 'chat-a': suggest } })
    resetComputerChoicesForTests()
    expect(computerChoice(owner, 'chat-a')).toEqual(suggest)
    expect(computerChoice('https://pulpo.example|user-2', 'chat-a')).toEqual(DEFAULT_COMPUTER_CHOICE)
  })

  it('keeps working when storage fails', () => {
    localStorageStub.getItem.mockImplementationOnce(() => { throw new Error('denied') })
    localStorageStub.setItem.mockImplementation(() => { throw new Error('quota') })
    const listener = vi.fn()
    const unsubscribe = subscribeComputerChoices(listener)
    expect(computerChoice(owner, null)).toEqual(DEFAULT_COMPUTER_CHOICE)
    chooseComputer(owner, 'chat-a', full)
    expect(computerChoice(owner, 'chat-a')).toEqual(full)
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
    localStorageStub.setItem.mockReset()
  })

  it('works without any storage', () => {
    vi.stubGlobal('localStorage', undefined)
    chooseComputer(owner, null, full)
    expect(computerChoice(owner, 'chat-z')).toEqual(full)
  })

  it('drops malformed stored choices', () => {
    expect(parseComputerChoices('{')).toEqual({ last: DEFAULT_COMPUTER_CHOICE, chats: {} })
    expect(parseComputerChoices(JSON.stringify({ v: 2, last: full, chats: {} })).last).toEqual(DEFAULT_COMPUTER_CHOICE)
    expect(parseComputerChoices(JSON.stringify({
      v: 1,
      last: { enabled: true, access: 'root', folder: null },
      chats: { good: { enabled: true, access: 'read', folder: { path: '/a', name: 'a' } }, badFolder: { enabled: true, access: 'write', folder: { path: 3 } } },
    }))).toEqual({
      last: DEFAULT_COMPUTER_CHOICE,
      chats: { good: { enabled: true, access: 'read', folder: { path: '/a', name: 'a' } }, badFolder: { enabled: true, access: 'write', folder: null } },
    })
  })
})
