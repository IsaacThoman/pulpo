import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { ComputerService } from './service'

/** Sent to the renderer after any change is added or decided. */
export const COMPUTER_CHANGES_CHANGED_CHANNEL = 'desktop:computer:changes-changed'

/**
 * The renderer's only way in. Each channel checks the sender first; none runs a command or touches
 * a path except through a session the grants cover (`handle`), or through the native dialogs.
 */
export function registerComputerIpc(ipcMain: Pick<IpcMain, 'handle'>, service: ComputerService, assertTrustedSender: (event: IpcMainInvokeEvent) => void): void {
  const channel = <T extends unknown[], R>(name: string, run: (...args: T) => Promise<R>) => {
    ipcMain.handle(`desktop:computer:${name}`, async (event, ...args: unknown[]) => {
      assertTrustedSender(event)
      return run(...(args as T))
    })
  }
  channel('status', () => service.status())
  channel('choose-folder', () => service.chooseFolder())
  channel('allow-full-access', () => service.allowFullAccess())
  channel('revoke-full-access', () => service.revokeFullAccess())
  channel('forget-folder', (folder: string) => service.forgetFolder(folder))
  channel('forget-app', (id: string) => service.forgetApp(id))
  channel('begin', (session: Parameters<ComputerService['begin']>[0]) => service.begin(session))
  channel('end', (sessionId: string) => service.end(sessionId))
  channel('sessions', () => service.sessions())
  channel('handle', (request: unknown) => service.handle(request))
  channel('changes:list', (filter: Parameters<ComputerService['listChanges']>[0]) => service.listChanges(filter ?? {}))
  channel('changes:get', (id: string) => service.getChange(id))
  channel('changes:accept', (ids: string[], options?: { overwrite?: boolean }) => service.acceptChanges(ids, options))
  channel('changes:reject', (ids: string[]) => service.rejectChanges(ids))
}
