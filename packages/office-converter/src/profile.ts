import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * User settings every conversion runs with. Documents are untrusted, so LibreOffice must not run
 * their macros or embedded objects, update links to other files, or reach the network: HTTP(S)
 * goes to a proxy on the discard port, so a linked image or remote template cannot be fetched
 * even where the container's network would allow it.
 */
const LOCKED_SETTINGS: Array<{ path: string; name: string; value: string }> = [
  { path: '/org.openoffice.Office.Common/Security/Scripting', name: 'DisableMacrosExecution', value: 'true' },
  // "Very high": only macros from trusted locations, and there are none.
  { path: '/org.openoffice.Office.Common/Security/Scripting', name: 'MacroSecurityLevel', value: '3' },
  { path: '/org.openoffice.Office.Common/Security/Scripting', name: 'DisableActiveContent', value: 'true' },
  { path: '/org.openoffice.Office.Common/Security/Scripting', name: 'DisableOLEAutomation', value: 'true' },
  { path: '/org.openoffice.Office.Common/Security/Scripting', name: 'BlockUntrustedRefererLinks', value: 'true' },
  // Writer: 0 always, 1 on request, 2 never. Calc: 0 always, 1 never, 2 on request.
  { path: '/org.openoffice.Office.Writer/Content/Update', name: 'Link', value: '2' },
  { path: '/org.openoffice.Office.Calc/Content/Update', name: 'Link', value: '1' },
  { path: '/org.openoffice.Inet/Settings', name: 'ooInetProxyType', value: '1' },
  { path: '/org.openoffice.Inet/Settings', name: 'ooInetNoProxy', value: '' },
  { path: '/org.openoffice.Inet/Settings', name: 'ooInetHTTPProxyName', value: '127.0.0.1' },
  { path: '/org.openoffice.Inet/Settings', name: 'ooInetHTTPProxyPort', value: '9' },
  { path: '/org.openoffice.Inet/Settings', name: 'ooInetHTTPSProxyName', value: '127.0.0.1' },
  { path: '/org.openoffice.Inet/Settings', name: 'ooInetHTTPSProxyPort', value: '9' },
  // Nothing to recover or report from a throwaway profile.
  { path: '/org.openoffice.Office.Recovery/RecoveryInfo', name: 'Enabled', value: 'false' },
  { path: '/org.openoffice.Office.Common/Misc', name: 'UseOpenCL', value: 'false' },
]

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function registryModifications(): string {
  const items = LOCKED_SETTINGS.map(({ path, name, value }) =>
    `<item oor:path="${path}"><prop oor:name="${name}" oor:op="fuse"><value>${escapeXml(value)}</value></prop></item>`)
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    ...items,
    '</oor:items>',
    '',
  ].join('\n')
}

/** Seeds a LibreOffice user installation directory with the locked settings. */
export async function seedProfile(directory: string): Promise<void> {
  await mkdir(join(directory, 'user'), { recursive: true, mode: 0o700 })
  await writeFile(join(directory, 'user', 'registrymodifications.xcu'), registryModifications(), { mode: 0o600 })
}
