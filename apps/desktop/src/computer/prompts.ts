import { BrowserWindow, Notification, dialog } from 'electron'
import type { ToolApproval } from '@pulpo/contracts'
import type { ComputerPromptHandle, ComputerPrompts } from './agent'

function focusWindow(window: BrowserWindow | null): void {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function notifyIfHidden(window: BrowserWindow | null, title: string, body: string): void {
  const visible = window && !window.isDestroyed() && window.isVisible() && window.isFocused()
  if (visible || !Notification.isSupported()) return
  new Notification({ title, body, silent: false }).show()
}

function approvalMessage(approval: ToolApproval): { message: string; detail: string } {
  if (approval.kind === 'bash') {
    return { message: `The agent wants to run a command on ${approval.computerName}`, detail: approval.summary }
  }
  const verb = approval.kind === 'write' ? 'create or overwrite' : 'edit'
  return { message: `The agent wants to ${verb} a file on ${approval.computerName}`, detail: approval.summary }
}

/** Native dialogs shown by the main process. Each returns a handle so a decision made elsewhere can close it. */
export function createNativeComputerPrompts(getWindow: () => BrowserWindow | null): ComputerPrompts {
  const show = (title: string, message: string, detail: string, buttons: [string, string]): ComputerPromptHandle => {
    const controller = new AbortController()
    const window = getWindow()
    focusWindow(window)
    notifyIfHidden(window, title, message)
    const options: Electron.MessageBoxOptions = {
      type: 'question', title, message, detail, buttons, defaultId: 1, cancelId: 1, noLink: true, signal: controller.signal,
    }
    const shown = window && !window.isDestroyed() ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options)
    return {
      decision: shown.then((result) => !controller.signal.aborted && result.response === 0).catch(() => false),
      dismiss: () => controller.abort(),
    }
  }
  return {
    approval(approval) {
      const { message, detail } = approvalMessage(approval)
      return show('Pulpo agent approval', message, `${detail}\n\nApproving runs it now with your permissions. You can also decide from the chat.`, ['Approve', 'Deny'])
    },
    pairing(pairing) {
      const where = pairing.requestedIp ? ` from ${pairing.requestedIp}` : ''
      return show(
        'Pair a device with this computer',
        `${pairing.deviceLabel} wants to use ${pairing.computerName} as its agent workspace`,
        `Request${where} (${pairing.appType}, ${pairing.platform}). Approve only if this is your device. You can revoke pairings later in Settings.`,
        ['Approve', 'Deny'],
      )
    },
  }
}
