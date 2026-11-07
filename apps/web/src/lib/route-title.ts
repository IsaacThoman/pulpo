import { matchPath } from 'react-router-dom'
import { ui } from '@/i18n/ui'
import { pageTitle } from './document-title'

/** The admin panel's sections, by their path under /admin. */
function adminSection(section: string): string | null {
  switch (section) {
    case 'users': return ui("Users")
    case 'chats': return ui("Chats")
    case 'reports': return ui("Reports")
    case 'image-models': return ui("Image models")
    case 'speech-models': return ui("Speech models")
    case 'providers': return ui("Providers")
    case 'labs': return ui("Labs")
    case 'icons': return ui("Icons")
    case 'models': return ui("Models")
    case 'usage': return ui("Usage")
    case 'billing': return ui("Billing")
    case 'settings': return ui("Settings")
    default: return null
  }
}

function adminUsageSection(section: string | undefined): string | null {
  switch (section) {
    case 'requests': return ui("Requests")
    case 'insights': return ui("Insights")
    case 'workspaces': return ui("Workspaces")
    default: return ui("Leaderboard")
  }
}

/**
 * The tab title for a route ("Files – Pulpo"), shown until the view sets a more specific one
 * (a chat's or a document's title). Null where there is nothing better than "Pulpo".
 */
export function routeTitle(pathname: string, newChatLabel: string): string | null {
  const match = (pattern: string) => matchPath({ path: pattern, end: true }, pathname)
  if (pathname === '/') return pageTitle(newChatLabel)
  if (match('/c/:chatId')) return pageTitle(ui("Chat"))
  if (pathname.startsWith('/files/trash')) return pageTitle(ui("Trash"), ui("Files"))
  if (pathname === '/files' || pathname.startsWith('/files/')) return pageTitle(ui("Files"))
  if (match('/attachments/:attachmentId')) return pageTitle(ui("Attachment"))
  if (pathname.startsWith('/usage')) return pageTitle(ui("Usage"))
  if (match('/friends/leaderboard')) return pageTitle(ui("Leaderboard"), ui("Friends"))
  if (pathname.startsWith('/friends')) return pageTitle(ui("Friends"))
  if (match('/api-keys')) return pageTitle(ui("API keys"))
  if (match('/billing')) return pageTitle(ui("Billing"))
  const admin = matchPath({ path: '/admin/:section/*', end: false }, pathname)
  if (admin) {
    const section = admin.params.section!
    if (section === 'chats' && admin.params['*']) return pageTitle(ui("Chat"), ui("Admin panel"))
    if (section === 'usage') return pageTitle(adminUsageSection(admin.params['*']?.split('/')[0]), ui("Usage"), ui("Admin panel"))
    return pageTitle(adminSection(section), ui("Admin panel"))
  }
  if (pathname.startsWith('/admin')) return pageTitle(ui("Admin panel"))
  if (match('/login')) return pageTitle(ui("Sign in"))
  if (match('/login/options')) return pageTitle(ui("Sign-in options"))
  if (match('/signup')) return pageTitle(ui("Sign up"))
  if (match('/forgot-password')) return pageTitle(ui("Forgot password"))
  if (match('/reset-password')) return pageTitle(ui("Reset password"))
  if (match('/setup')) return pageTitle(ui("Set up Pulpo"))
  if (match('/account-deletion')) return pageTitle(ui("Delete account"))
  if (match('/pending')) return pageTitle(ui("Account pending"))
  if (match('/share/:token')) return pageTitle(ui("Shared chat"))
  if (pathname.startsWith('/mobile/passkey')) return pageTitle(ui("Passkeys"))
  return null
}
