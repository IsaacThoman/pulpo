import { Copy, CreditCard, ExternalLink, Ghost, KeyRound, PinOff, Plus, Search, SquarePen, UserRound, UsersRound, Wallet } from 'lucide-react'
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { useTranslation } from '@/i18n/useAppTranslation'
import { ui } from '@/i18n/ui'
import { writeClipboardText } from '@/lib/clipboard'
import { openBillingPortal } from '@/lib/billing'
import { ownProfilePath } from '@/lib/profile'
import { toggleSidebarPin, type SidebarPinKey } from '@/lib/sidebar-pins'
import { useAuth } from '@/stores/auth'
import { useSettings } from '@/stores/settings'
import { FileContextMenu, type ContextMenuPoint } from '@/features/files/browser/FileContextMenu'
import { useFileToasts } from '@/features/files/browser/toasts'
import { OpenChatToLeftItem } from '@/features/side-panel/AgentActions'

/** The sidebar's nav buttons with a right-click menu (Files has its own, FilesNavMenu); `friends` is People. */
export type NavItemMenuKey = 'newChat' | Extract<SidebarPinKey, 'searchChats' | 'billing' | 'friends' | 'apiKeys'>

export interface NavItemMenuState extends ContextMenuPoint {
  key: NavItemMenuKey
}

const toast = (message: string, tone?: 'error') => useFileToasts.getState().show({ message, tone })

/** The right-click menu for a nav button at the top of the sidebar. */
export function NavItemMenu({ menu, onClose, onNewChat, onSearch, subscribed, go }: {
  menu: NavItemMenuState | null
  onClose: () => void
  onNewChat: (temporary?: boolean) => void
  onSearch: () => void
  /** Whether there is a subscription to manage in the billing portal. */
  subscribed: boolean
  go: (path: string) => void
}) {
  const { t } = useTranslation()
  const billingEnabled = useAuth((state) => state.billingEnabled)
  const username = useAuth((state) => state.user?.username)
  const sidebarPins = useSettings((state) => state.sidebarPins)
  const setSetting = useSettings((state) => state.set)
  const key = menu?.key
  const unpin = key && key !== 'newChat' && (
    <DropdownMenuItem onSelect={() => setSetting('sidebarPins', toggleSidebarPin(sidebarPins, key))}>
      <PinOff /> {t('chat.unpin')}
    </DropdownMenuItem>
  )
  const copyHandle = async () => {
    if (!username) return
    if (await writeClipboardText(username)) toast(ui("Handle copied"))
    else toast(ui("Could not copy to the clipboard."), 'error')
  }
  const openPortal = () => openBillingPortal().catch((error: unknown) => {
    toast(error instanceof Error ? error.message : String(error), 'error')
  })
  return (
    <FileContextMenu point={menu} onClose={onClose}>
      {key === 'newChat' && (
        <>
          <DropdownMenuItem onSelect={() => onNewChat()}><SquarePen /> {t('chat.newChat')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onNewChat(true)}><Ghost /> {t('chat.newTemporaryChat')}</DropdownMenuItem>
          <OpenChatToLeftItem />
        </>
      )}
      {key === 'searchChats' && (
        <>
          <DropdownMenuItem onSelect={onSearch}><Search /> {t('sidebar.searchChats')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          {unpin}
        </>
      )}
      {key === 'billing' && (
        <>
          {billingEnabled && (
            <>
              <DropdownMenuItem onSelect={() => go('/billing')}><CreditCard /> {ui("Manage billing")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => go('/billing?topup=1')}><Wallet /> {ui("Add credits")}</DropdownMenuItem>
              {subscribed && <DropdownMenuItem onSelect={() => void openPortal()}><ExternalLink /> {ui("Billing portal")}</DropdownMenuItem>}
              <DropdownMenuSeparator />
            </>
          )}
          {unpin}
        </>
      )}
      {key === 'friends' && (
        <>
          <DropdownMenuItem onSelect={() => go(ownProfilePath(username))}><UserRound /> {ui("Your profile")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => go('/friends')}><UsersRound /> {ui("View friends")}</DropdownMenuItem>
          {username && <DropdownMenuItem onSelect={() => void copyHandle()}><Copy /> {ui("Copy handle")}</DropdownMenuItem>}
          <DropdownMenuSeparator />
          {unpin}
        </>
      )}
      {key === 'apiKeys' && (
        <>
          <DropdownMenuItem onSelect={() => go('/api-keys')}><KeyRound /> {ui("View keys")}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => go('/api-keys?new=1')}><Plus /> {ui("New key")}</DropdownMenuItem>
          <DropdownMenuSeparator />
          {unpin}
        </>
      )}
    </FileContextMenu>
  )
}
