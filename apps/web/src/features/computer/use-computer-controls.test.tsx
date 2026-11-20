// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComputerFolder } from '@pulpo/contracts'
import { AgentMenu } from '@/components/chat/AgentMenu'
import { clearAdminChatGrant, setAdminChatGrant, type AdminChatGrant } from '@/features/admin-chat/access'
import { useAuth } from '@/stores/auth'
import { useCatalog } from '@/stores/catalog'
import { useFileToasts } from '@/features/files/browser/toasts'
import { chooseComputer, computerChoice, resetComputerChoicesForTests } from './selection'
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

function Harness({ chatId = 'chat-a', files = true, reach }: { chatId?: string | null; files?: boolean; reach?: 'mentioned' | 'all' }) {
  const controls = useComputerControls({ chatId, onEnable })
  return (
    <AgentMenu
      enabled
      disabled={false}
      computer={controls.controls}
      files={files ? { mode: 'suggest', reach, onModeChange: vi.fn() } : undefined}
      onSelect={vi.fn()}
    />
  )
}

/** The menu stays open after a choice; this is the user pressing Escape until it is gone. */
async function closeMenu() {
  await waitFor(() => {
    if (!screen.queryAllByRole('menu').length) return
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    throw new Error('the menu is still open')
  })
}

async function openMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: /^Agent options/ }), { key: 'Enter' })
  return screen.findByRole('menu')
}

async function openComputer() {
  await closeMenu()
  await openMenu()
  const trigger = screen.getByRole('menuitem', { name: /This computer/ })
  fireEvent.keyDown(trigger, { key: 'ArrowRight' })
  return screen.findByRole('group', { name: 'This computer' })
}

/** The rows under Access, as they read. */
async function accessRows() {
  await closeMenu()
  await openMenu()
  return within(screen.getByRole('group', { name: 'Access' })).getAllByRole('menuitem').map((item) => item.textContent)
}

const checked = (group: HTMLElement) => within(group).getAllByRole('menuitemradio')
  .filter((item) => item.getAttribute('aria-checked') === 'true').map((item) => item.textContent)

beforeEach(() => {
  localStorage.clear()
  resetComputerChoicesForTests()
  resetComputerSessionsForTests()
  allowedFolders = []
  useFileToasts.setState({ toasts: [] })
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

describe('Access in the agent menu', () => {
  it('offers This computer only with the bridge, the instance allowing it, and the user’s own chat', async () => {
    const { unmount } = render(<Harness />)
    await openMenu()
    expect(screen.getByRole('menuitem', { name: /This computer/ })).not.toBeNull()
    unmount()

    for (const setup of [
      () => { window.pulpoDesktop = { platform: 'desktop' } as unknown as typeof window.pulpoDesktop },
      () => { useCatalog.setState({ computerAccess: false }) },
      () => { setAdminChatGrant({ chatId: 'chat-a' } as AdminChatGrant) },
    ]) {
      setup()
      const view = render(<Harness />)
      await openMenu()
      expect(screen.queryByRole('menuitem', { name: /This computer/ })).toBeNull()
      // Files keep their row under Access, as on the web.
      expect(within(screen.getByRole('group', { name: 'Access' })).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Pulpo FilesItems you mention · Suggest changes'])
      view.unmount()
      window.pulpoDesktop = { platform: 'desktop', computer } as unknown as typeof window.pulpoDesktop
      useCatalog.setState({ computerAccess: true })
      clearAdminChatGrant()
    }
  })

  it('says for Files and for This computer what the agent can reach and what it may do', async () => {
    const view = render(<Harness />)
    expect(await accessRows()).toEqual(['Pulpo FilesItems you mention · Suggest changes', 'This computerOff'])
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /^Pulpo Files/ }), { key: 'ArrowRight' })
    const files = await screen.findByRole('group', { name: 'Changes to Files' })
    expect(files.textContent).toBe('Read onlySuggest changesEdit directly')
    expect(checked(files)).toEqual(['Suggest changes'])
    view.unmount()

    render(<Harness reach="all" />)
    expect(await accessRows()).toEqual(['Pulpo FilesAll files · Suggest changes', 'This computerOff'])
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /^Pulpo Files/ }), { key: 'ArrowRight' })
    expect((await screen.findByRole('group', { name: 'Changes to Files' })).textContent).toBe('Read onlySuggest changesEdit directly')
  })

  it('starts with This computer Off, with a folder offered ahead of turning it on', async () => {
    render(<Harness />)
    const options = await openComputer()
    expect(within(options).getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual([
      'Off',
      'Full access',
      'Read only',
      'Suggest changes',
      'Edit directly',
    ])
    expect(checked(options)).toEqual(['Off'])
    const folder = screen.getByRole('group', { name: 'Folder' })
    expect(within(folder).queryAllByRole('menuitemradio')).toEqual([])
    expect(within(folder).getByText('Used once this computer is on')).not.toBeNull()
  })

  it('turns on a folder mode by choosing a folder first, and cancelling leaves it Off', async () => {
    computer.chooseFolder.mockResolvedValueOnce(null)
    render(<Harness />)
    fireEvent.click(within(await openComputer()).getByRole('menuitemradio', { name: /Read only/ }))
    await waitFor(() => expect(computer.chooseFolder).toHaveBeenCalledOnce())
    expect(computerChoice(owner, 'chat-a').enabled).toBe(false)
    expect(checked(await openComputer())).toEqual(['Off'])
    // Cancelling the dialog needs no explanation.
    expect(useFileToasts.getState().toasts).toEqual([])

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Read only/ }))
    await waitFor(() => expect(computerChoice(owner, 'chat-a')).toEqual({ enabled: true, access: 'read', folder: project }))
    expect(onEnable).toHaveBeenCalledOnce()
    // The submenu is still open and shows the choice, with the folder it now works in.
    expect(checked(screen.getByRole('group', { name: 'This computer' }))).toEqual(['Read only'])
    expect(checked(screen.getByRole('group', { name: 'Folder' }))).toEqual(['project'])
    await closeMenu()
    const trigger = screen.getByRole('button', { name: 'Agent options, This computer' })
    expect(trigger.querySelector('.lucide-laptop')).not.toBeNull()
    expect(await accessRows()).toEqual(['Pulpo FilesItems you mention · Suggest changes', 'This computerproject · Read only'])
    // New chats start from the last choice.
    expect(computerChoice(owner, null)).toEqual({ enabled: true, access: 'read', folder: project })
  })

  it('asks before Full access, stays Off when declined, and keeps Files once on', async () => {
    computer.allowFullAccess.mockResolvedValueOnce(false)
    render(<Harness />)
    fireEvent.click(within(await openComputer()).getByRole('menuitemradio', { name: /Full access/ }))
    await waitFor(() => expect(computer.allowFullAccess).toHaveBeenCalledOnce())
    expect(computerChoice(owner, 'chat-a').enabled).toBe(false)
    expect(computer.chooseFolder).not.toHaveBeenCalled()
    expect(useFileToasts.getState().toasts).toEqual([])

    fireEvent.click(within(await openComputer()).getByRole('menuitemradio', { name: /Full access/ }))
    await waitFor(() => expect(computerChoice(owner, 'chat-a')).toEqual({ enabled: true, access: 'full', folder: null }))
    expect(await accessRows()).toEqual(['Pulpo FilesItems you mention · Suggest changes', 'This computerFull access'])
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /This computer/ }), { key: 'ArrowRight' })
    expect(checked(await screen.findByRole('group', { name: 'This computer' }))).toEqual(['Full access'])
    expect(checked(screen.getByRole('group', { name: 'Folder' }))).toEqual(['No folder'])
  })

  it('says so when the app cannot be used, instead of doing nothing', async () => {
    computer.status.mockResolvedValue({ fullAccess: false, folders: [], defaultFolder: { path: '/Users/me/Pulpo', name: 'Pulpo' }, signedIn: false })
    computer.allowFullAccess.mockResolvedValue(false)
    computer.chooseFolder.mockResolvedValue(null)
    render(<Harness />)
    fireEvent.click(within(await openComputer()).getByRole('menuitemradio', { name: /Full access/ }))
    await waitFor(() => expect(useFileToasts.getState().toasts.map((toast) => toast.message)).toEqual(["Can't use this computer right now. Check your connection and try again."]))
    expect(computerChoice(owner, 'chat-a').enabled).toBe(false)

    useFileToasts.setState({ toasts: [] })
    fireEvent.click(within(await openComputer()).getByRole('menuitemradio', { name: /Edit directly/ }))
    await waitFor(() => expect(useFileToasts.getState().toasts).toHaveLength(1))
    expect(checked(await openComputer())).toEqual(['Off'])
  })

  it('keeps Full access on while a folder is chosen or cleared, and Off remembers both', async () => {
    render(<Harness />)
    fireEvent.click(within(await openComputer()).getByRole('menuitemradio', { name: /Full access/ }))
    await waitFor(() => expect(computerChoice(owner, 'chat-a').enabled).toBe(true))
    await openComputer()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Choose folder…' }))
    await waitFor(() => expect(computerChoice(owner, 'chat-a')).toEqual({ enabled: true, access: 'full', folder: project }))

    expect(checked(await openComputer())).toEqual(['Full access'])
    const folder = screen.getByRole('group', { name: 'Folder' })
    expect(checked(folder)).toEqual(['project'])
    fireEvent.click(within(folder).getByRole('menuitemradio', { name: 'No folder' }))
    await waitFor(() => expect(computerChoice(owner, 'chat-a')).toEqual({ enabled: true, access: 'full', folder: null }))

    fireEvent.click(within(await openComputer()).getByRole('menuitemradio', { name: 'Off' }))
    await waitFor(() => expect(computerChoice(owner, 'chat-a')).toEqual({ enabled: false, access: 'full', folder: null }))
    // Off keeps the folder choices, muted and saying they wait for the computer to be on.
    expect(checked(screen.getByRole('group', { name: 'Folder' }))).toEqual(['No folder'])
    expect(screen.getByText('Used once this computer is on')).not.toBeNull()
    await closeMenu()
    expect(screen.getByRole('button', { name: 'Agent options, Pulpo Agent' })).not.toBeNull()
    expect(await accessRows()).toEqual(['Pulpo FilesItems you mention · Suggest changes', 'This computerOff'])
  })

  it('lets a folder be chosen while off, and uses it once an access is chosen', async () => {
    render(<Harness />)
    await openComputer()
    expect(screen.getByText('Used once this computer is on')).not.toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Choose folder…' }))
    await waitFor(() => expect(computerChoice(owner, 'chat-a')).toEqual({ enabled: false, access: 'suggest', folder: project }))
    expect(checked(await openComputer())).toEqual(['Off'])
    expect(checked(screen.getByRole('group', { name: 'Folder' }))).toEqual(['project'])
    expect(await accessRows()).toEqual(['Pulpo FilesItems you mention · Suggest changes', 'This computerOff'])

    // The folder was chosen already, so turning it on does not ask again.
    fireEvent.click(within(await openComputer()).getByRole('menuitemradio', { name: /Read only/ }))
    await waitFor(() => expect(computerChoice(owner, 'chat-a')).toEqual({ enabled: true, access: 'read', folder: project }))
    expect(computer.chooseFolder).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Used once this computer is on')).toBeNull()
  })

  it('applies a folder to the choice as it stands when the folder dialog closes', async () => {
    const earlier = { path: '/Users/me/earlier', name: 'earlier' }
    render(<Harness />)
    fireEvent.click(within(await openComputer()).getByRole('menuitemradio', { name: /Read only/ }))
    await waitFor(() => expect(computerChoice(owner, 'chat-a').enabled).toBe(true))
    let close!: (folder: ComputerFolder) => void
    computer.chooseFolder.mockReturnValueOnce(new Promise<ComputerFolder>((resolve) => { close = resolve }))
    await openComputer()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Choose folder…' }))
    // The access changes while the dialog is still open.
    act(() => chooseComputer(owner, 'chat-a', { enabled: true, access: 'full', folder: project }))
    await act(async () => close(earlier))
    await waitFor(() => expect(computerChoice(owner, 'chat-a')).toEqual({ enabled: true, access: 'full', folder: earlier }))
  })

  it('offers folders allowed earlier, so one can be chosen without the folder dialog', async () => {
    const earlier = { path: '/Users/me/earlier', name: 'earlier' }
    allowedFolders = [project, earlier]
    render(<Harness />)
    fireEvent.click(within(await openComputer()).getByRole('menuitemradio', { name: /Full access/ }))
    await waitFor(() => expect(computerChoice(owner, 'chat-a').enabled).toBe(true))
    await openComputer()
    let folder = screen.getByRole('group', { name: 'Folder' })
    expect(within(folder).getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual(['project', 'earlier', 'No folder'])
    fireEvent.click(within(folder).getByRole('menuitemradio', { name: 'earlier' }))
    await waitFor(() => expect(computerChoice(owner, 'chat-a')).toEqual({ enabled: true, access: 'full', folder: earlier }))
    expect(computer.chooseFolder).not.toHaveBeenCalled()

    await openComputer()
    folder = screen.getByRole('group', { name: 'Folder' })
    expect(checked(folder)).toEqual(['earlier'])
    // A folder mode needs a folder, so none is not offered there.
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Suggest changes/ }))
    await waitFor(() => expect(computerChoice(owner, 'chat-a').access).toBe('suggest'))
    await openComputer()
    expect(within(screen.getByRole('group', { name: 'Folder' })).queryByRole('menuitemradio', { name: 'No folder' })).toBeNull()
  })

  it('keeps each chat’s own choice', async () => {
    const first = render(<Harness chatId="chat-a" />)
    fireEvent.click(within(await openComputer()).getByRole('menuitemradio', { name: /Full access/ }))
    await waitFor(() => expect(computerChoice(owner, 'chat-a').enabled).toBe(true))
    first.unmount()
    render(<Harness chatId="chat-b" />)
    await act(async () => undefined)
    expect(screen.getByRole('button', { name: 'Agent options, This computer' })).not.toBeNull()
    fireEvent.click(within(await openComputer()).getByRole('menuitemradio', { name: 'Off' }))
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
    const off = await screen.findByRole('menuitemradio', { name: 'Off' })
    await waitFor(() => expect(document.activeElement).toBe(off))
    fireEvent.keyDown(off, { key: 'ArrowLeft' })
    await waitFor(() => expect(document.activeElement).toBe(sub))
    fireEvent.keyDown(sub, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})
