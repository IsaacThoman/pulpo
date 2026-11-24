import { existsSync } from 'node:fs'
import path from 'node:path'
import { WINDOWS_SHELL_ARGS } from '../platform'
import type { ControlHelperCommand } from '../../../../../packages/workspace-daemon/src/control/helper'

/**
 * The native helper as the main process uses it. The client that starts it and asks it one thing at
 * a time is shared with the workspace daemon (packages/workspace-daemon/src/control/helper.ts);
 * where this system's helper is, is the desktop app's own business.
 */
export { ControlHelper, ControlHelperError, type ControlHelperCommand, type ControlHelperOptions } from '../../../../../packages/workspace-daemon/src/control/helper'

/**
 * Where this system's helper is, or null when there is none: macOS runs the binary built by
 * `scripts/build-control-helper.mjs`, Windows loads the C# beside `host.ps1` with the built-in
 * Windows PowerShell (never PowerShell 7, whose compiler lacks what the helper uses).
 * `directory` holds the helper: the app's resources when packaged, `native/…` in a checkout.
 */
export function controlHelperCommand(platform: NodeJS.Platform, directory: string, env: NodeJS.ProcessEnv, exists: (file: string) => boolean = existsSync): ControlHelperCommand | null {
  if (platform === 'darwin') {
    const binary = path.posix.join(directory, 'pulpo-control')
    return exists(binary) ? { file: binary, args: [] } : null
  }
  if (platform === 'win32') {
    const host = path.win32.join(directory, 'host.ps1')
    if (!exists(host)) return null
    const root = env.SystemRoot ?? env.SYSTEMROOT ?? 'C:\\Windows'
    const powershell = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    return exists(powershell) ? { file: powershell, args: [...WINDOWS_SHELL_ARGS, '-File', host] } : null
  }
  return null
}
