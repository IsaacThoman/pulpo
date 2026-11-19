// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComputerFolder } from '@pulpo/contracts'
import { AgentMenu } from '@/components/chat/AgentMenu'
import { clearAdminChatGrant, setAdminChatGrant, type AdminChatGrant } from '@/features/admin-chat/access'
import { useAuth } from '@/stores/auth'
import { useCatalog } from '@/stores/catalog'
import { computerChoice, resetComputerChoicesForTests } from './selection'
import { resetComputerSessionsForTests } from './sessions'
import { useComputerControls } from './use-computer-controls'

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
})

const project: ComputerFolder = { path: '/Users/me/project', name: 'project' }
const userId = '00000000-0000-4000-8000-000000000001'
const owner = `https://pulpo.baby|${userId}`

let computer: { status: ReturnType<typeof vi.fn>; chooseFolder: ReturnType<typeof vi.fn>; allowFullAccess: ReturnType<typeof vi.fn>; begin: ReturnType<typeof vi.fn> }
let allowedFolders: Array<{ path: string; name: string }> = []
const onEnable = vi.fn()

function Harness({ chatId = 'chat-a', files = true }: { chatId?: string | null; files?: boolean }) {
  const controls = useComputerControls({ chatId, onEnable })
  return (
    <AgentMenu
      enabled
      disabled={false}
      computer={controls.controls}
      files={files ? { mode: 'suggest', onModeChange: vi.fn() } : undefined}
      onSelect={vi.fn()}
    />
  )
}

async function openMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: /^Agent options/ }), { key: 'Enter' })
  return screen.findByRole('menu')
}

async function openComputer() {
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
  await openMenu()
  const trigger = screen.getByRole('menuitem', { name: /This computer/ })
  fireEvent.keyDown(trigger, { key: 'ArrowRight' })
  return screen.findByRole('group', { name: 'Access' })
}

beforeEach(() => {
  localStorage.clear()
  resetComputerChoicesForTests()
  resetComputerSessionsForTests()
  allowedFolders = []
  computer = {
    status: vi.fn(async () => ({ fullAccess: false, folders: allowedFolders, defaultFolder: { path: '/Users/me/Pulpo', name: 'Pulpo' } })),
    chooseFolder: vi.fn(async () => project), allowFullAccess: vi.fn(async () => true), begin: vi.fn(async () => ({ ok: true })),
  }
  window.pulpoDesktop = { platform: 'desktop', computer } as unknown as typeof window.pulpoDesktop
  useAuth.setState({ user: { id: userId } as never })
  useCatalog.setState({ computerAccess: true })
})
afterEach(() => {
  cleanup()
  delete window.pulpoDesktop
  clearAdminChatGrant()
  vi.clearAllMocks()
})

describe('Workspace menu', () => {
  it('is offered only with the bridge, the instance allowing it, and the user’s own chat', async () => {
    const { unmount } = render(<Harness />)
    await openMenu()
    expect(screen.getByRole('group', { name: 'Workspace' })).not.toBeNull()
    unmount()

    for (const setup of [
      () => { window.pulpoDesktop = { platform: 'desktop' } as unknown as typeof window.pulpoDesktop },
      () => { useCatalog.setState({ computerAccess: false }) },
      () => { setAdminChatGrant({ chatId: 'chat-a' } as AdminChatGrant) },
    ]) {
      setup()
      const view = render(<Harness />)
      await openMenu()
      expect(screen.queryByRole('group', { name: 'Workspace' })).toBeNull()
      view.unmount()
      window.pulpoDesktop = { platform: 'desktop', computer } as unknown as typeof window.pulpoDesktop
      useCatalog.setState({ computerAccess: true })
      clearAdminChatGrant()
    }
  })

  it('lays out Cloud, This computer with Folder and Access, then Files', async () => {
    render(<Harness />)
    await openMenu()
    const workspace = screen.getByRole('group', { name: 'Workspace' })
    expect(within(workspace).getByRole('menuitemradio', { name: 'Cloud' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('group', { name: 'Changes to Files' })).not.toBeNull()
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /This computer/ }), { key: 'ArrowRight' })
    const access = await screen.findByRole('group', { name: 'Access' })
    expect(within(access).getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      'Full accessCan run commands anywhere on this computer',
      'Read onlyThe agent can look but not change anything',
      'Suggest changesYou accept or reject each change',
      'Edit directlyChanges apply right away',
    ])
    const folder = screen.getByRole('group', { name: 'Folder' })
    expect(within(folder).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Choose folder…'])
  })

  it('turns on a folder mode by choosing a folder first, and cancelling changes nothing', async () => {
    computer.chooseFolder.mockResolvedValueOnce(null)
    render(<Harness />)
    fireEvent.click(within(await openComputer()).getByRole('menuitemradio', { name: /Read only/ }))
    await waitFor(() => expect(computer.chooseFolder).toHaveBeenCalledOnce())
    expect(computerChoice(owner, 'chat-a').enabled).toBe(false)

    fireEvent.click(within(await openComputer()).getByRole('menuitemradio', { name: /Read only/ }))
    await waitFor(() => expect(computerChoice(owner, 'chat-a')).toEqual({ enabled: true, access: 'read', folder: project }))
    expect(onEnable).toHaveBeenCalledOnce()
    const trigger = screen.getByRole('button', { name: 'Agent options, This computer' })
    expect(trigger.querySelector('.lucide-laptop')).not.toBeNull()
    // New chats start from the last choice.
    expect(computerChoice(owner, null)).toEqual({ enabled: true, access: 'read', folder: project })
  })

  it('asks before Full access, changes nothing when declined, and hides Files once on', async () => {
    computer.allowFullAccess.mockResolvedValueOnce(false)
    render(<Harness />)
    fireEvent.click(within(await openComputer()).getByRole('menuitemradio', { name: /Full access/ }))
    await waitFor(() => expect(computer.allowFullAccess).toHaveBeenCalledOnce())
    expect(computerChoice(owner, 'chat-a').enabled).toBe(false)
    expect(computer.chooseFolder).not.toHaveBeenCalled()

    fireEvent.click(within(await openComputer()).getByRole('menuitemradio', { name: /Full access/ }))
    await waitFor(() => expect(computerChoice(owner, 'chat-a')).toEqual({ enabled: true, access: 'full', folder: null }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await openMenu()
    expect(screen.queryByRole('group', { name: 'Changes to Files' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /This computer/ }), { key: 'ArrowRight' })
    const access = await screen.findByRole('group', { name: 'Access' })
    expect(within(access).getByRole('menuitemradio', { name: /Full access/ }).getAttribute('aria-checked')).toBe('true')
    const folder = screen.getByRole('group', { name: 'Folder' })
    expect(within(folder).getByRole('menuitemradio', { name: 'No folder' }).getAttribute('aria-checked')).toBe('true')
  })

  it('chooses a folder without changing anything else, and Cloud remembers it', async () => {
    render(<Harness />)
    fireEvent.click(within(await openComputer()).getByRole('menuitemradio', { name: /Full access/ }))
    await waitFor(() => expect(computerChoice(owner, 'chat-a').enabled).toBe(true))
    await openComputer()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Choose folder…' }))
    await waitFor(() => expect(computerChoice(owner, 'chat-a')).toEqual({ enabled: true, access: 'full', folder: project }))

    await openComputer()
    const folder = screen.getByRole('group', { name: 'Folder' })
    expect(within(folder).getByRole('menuitemradio', { name: 'project' }).getAttribute('aria-checked')).toBe('true')
    expect(within(folder).getByRole('menuitemradio', { name: 'No folder' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(within(folder).getByRole('menuitemradio', { name: 'No folder' }))
    await waitFor(() => expect(computerChoice(owner, 'chat-a').folder).toBeNull())

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await openMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Cloud' }))
    await waitFor(() => expect(computerChoice(owner, 'chat-a')).toEqual({ enabled: false, access: 'full', folder: null }))
    expect(screen.getByRole('button', { name: 'Agent options, Pulpo Agent' })).not.toBeNull()
  })

  it('offers folders allowed earlier, so one can be chosen without the folder dialog', async () => {
    const earlier = { path: '/Users/me/earlier', name: 'earlier' }
    allowedFolders = [project, earlier]
    render(<Harness />)
    await openComputer()
    let folder = screen.getByRole('group', { name: 'Folder' })
    expect(within(folder).getByRole('menuitemradio', { name: 'project' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(within(folder).getByRole('menuitemradio', { name: 'earlier' }))
    await waitFor(() => expect(computerChoice(owner, 'chat-a').folder).toEqual(earlier))
    expect(computer.chooseFolder).not.toHaveBeenCalled()
    // Choosing a folder alone does not turn This computer on.
    expect(computerChoice(owner, 'chat-a').enabled).toBe(false)

    await openComputer()
    folder = screen.getByRole('group', { name: 'Folder' })
    expect(within(folder).getByRole('menuitemradio', { name: 'earlier' }).getAttribute('aria-checked')).toBe('true')
    expect(within(folder).getByRole('menuitemradio', { name: 'project' }).getAttribute('aria-checked')).toBe('false')
  })

  it('keeps each chat’s own choice', async () => {
    const first = render(<Harness chatId="chat-a" />)
    fireEvent.click(within(await openComputer()).getByRole('menuitemradio', { name: /Full access/ }))
    await waitFor(() => expect(computerChoice(owner, 'chat-a').enabled).toBe(true))
    first.unmount()
    render(<Harness chatId="chat-b" />)
    await act(async () => undefined)
    expect(screen.getByRole('button', { name: 'Agent options, This computer' })).not.toBeNull()
    await openMenu()
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Cloud' }))
    await waitFor(() => expect(computerChoice(owner, 'chat-b').enabled).toBe(false))
    expect(computerChoice(owner, 'chat-a').enabled).toBe(true)
  })

  it('moves through the submenu with the keyboard and returns focus on Escape', async () => {
    render(<Harness files={false} />)
    const trigger = screen.getByRole('button', { name: /^Agent options/ })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    const sub = await screen.findByRole('menuitem', { name: /This computer/ })
    sub.focus()
    fireEvent.keyDown(sub, { key: 'ArrowRight' })
    const chooseFolder = await screen.findByRole('menuitem', { name: 'Choose folder…' })
    await waitFor(() => expect(document.activeElement).toBe(chooseFolder))
    fireEvent.keyDown(chooseFolder, { key: 'ArrowLeft' })
    await waitFor(() => expect(document.activeElement).toBe(sub))
    fireEvent.keyDown(sub, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})
