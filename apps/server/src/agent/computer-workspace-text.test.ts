import { describe, expect, it } from 'vitest'
import type { ComputerWorkspaceDescriptor } from '@pulpo/contracts'
import { attachmentWorkspacePath, BASE_AGENT_PROMPT, buildAgentSystemPrompt, buildAgentUserPrompt, restoredAttachmentWorkspacePath } from './policy.js'
import { createWorkspaceTools, workspaceToolText } from './tools.js'
import type { AgentWorkspace } from './workspace.js'

const mac: ComputerWorkspaceDescriptor = {
  kind: 'computer', computerId: '11111111-1111-4111-8111-111111111111', computerName: 'Studio', os: 'macos', accessMode: 'folder',
  root: '/Users/me/projects/site', attachmentsDir: '/Users/me/Library/Application Support/Pulpo/agent-workspace/attachments', homeDir: '/Users/me',
  shell: 'bash', approvalPolicy: 'default',
}
const windows: ComputerWorkspaceDescriptor = {
  ...mac, computerName: 'Office PC', os: 'windows', accessMode: 'full', root: 'C:\\Users\\me', attachmentsDir: 'C:\\Users\\me\\AppData\\Roaming\\Pulpo\\agent-workspace\\attachments', homeDir: 'C:\\Users\\me', shell: 'powershell',
}

describe('computer workspace prompt', () => {
  it('leaves the sandbox prompt untouched', () => {
    expect(buildAgentSystemPrompt('Model', 'Agent')).toBe(buildAgentSystemPrompt('Model', 'Agent', '', '', { kind: 'sandbox' }))
    expect(buildAgentSystemPrompt('Model', 'Agent').startsWith(BASE_AGENT_PROMPT)).toBe(true)
    expect(BASE_AGENT_PROMPT).toContain('disposable Ubuntu Linux workspace rooted at /workspace')
  })

  it('describes the real computer instead of a disposable sandbox', () => {
    const prompt = buildAgentSystemPrompt('Model', 'Agent', '', '', mac)
    expect(prompt).toContain('real macOS computer named "Studio"')
    expect(prompt).toContain('not a disposable sandbox')
    expect(prompt).toContain('/Users/me/projects/site')
    expect(prompt).toContain('must stay within it')
    expect(prompt).toContain('there is no sudo')
    expect(prompt).toContain('explicit approval')
    expect(prompt).not.toContain('disposable Ubuntu')
    expect(prompt).not.toContain('passwordless sudo')
    expect(prompt).not.toContain('/opt/pulpo/PACKAGES.md')
    // Shared guidance survives regardless of workspace kind.
    expect(prompt).toContain('Use attach_file when you have created a finished file')
  })

  it('explains PowerShell and whole-machine access on Windows', () => {
    const prompt = buildAgentSystemPrompt('Model', 'Agent', '', '', windows)
    expect(prompt).toContain('real Windows computer named "Office PC"')
    expect(prompt).toContain('PowerShell syntax')
    expect(prompt).toContain('access to the whole machine')
  })

  it('stages attachments under the computer attachments directory with native separators', () => {
    expect(attachmentWorkspacePath('report.pdf', 'abcdef12-3456', mac)).toBe(`${mac.attachmentsDir}/abcdef12-report.pdf`)
    expect(attachmentWorkspacePath('report.pdf', 'abcdef12-3456', windows)).toBe(`${windows.attachmentsDir}\\abcdef12-report.pdf`)
    expect(attachmentWorkspacePath('report.pdf', 'abcdef12-3456')).toBe('/workspace/abcdef12-report.pdf')
    const generated = { id: 'ffffffff-0000', originalName: 'chart.png', origin: 'assistant', workspacePath: `${mac.attachmentsDir}/chart.png` }
    expect(restoredAttachmentWorkspacePath(generated, mac)).toBe(`${mac.attachmentsDir}/chart.png`)
    expect(restoredAttachmentWorkspacePath({ ...generated, workspacePath: '/etc/passwd' }, mac)).toBe(`${mac.attachmentsDir}/ffffffff-chart.png`)
    expect(buildAgentUserPrompt([{ role: 'user', content: 'look' }], [{ id: 'abcdef12-3456', originalName: 'a.txt', mimeType: 'text/plain', sizeBytes: 3 }], windows))
      .toContain(`path=${JSON.stringify(`${windows.attachmentsDir}\\abcdef12-a.txt`)}`)
  })
})

describe('computer workspace tools', () => {
  const stub = (descriptor: AgentWorkspace['descriptor']) => ({ descriptor, execute: async () => ({ id: 'x', status: 'completed', output: '', exitCode: 0 }) }) as unknown as AgentWorkspace

  it('keeps the sandbox tool names and copy unchanged', () => {
    const names = createWorkspaceTools(stub({ kind: 'sandbox' }), 1_000).map((tool) => tool.name)
    expect(names).toEqual(['read', 'view_image', 'bash', 'write', 'edit', 'ls', 'find', 'grep', 'attach_file'])
    expect(workspaceToolText({ kind: 'sandbox' }).shell).toBe('Run a bash command in the disposable Linux workspace. Passwordless sudo is available.')
  })

  it('renames bash to shell and describes the folder boundary on a computer', () => {
    const tools = createWorkspaceTools(stub(mac), 1_000)
    expect(tools.map((tool) => tool.name)).toEqual(['read', 'view_image', 'shell', 'write', 'edit', 'ls', 'find', 'grep', 'attach_file'])
    const shell = tools.find((tool) => tool.name === 'shell')!
    expect(shell.description).toContain('real macOS computer')
    expect(shell.description).toContain('must stay inside that folder')
    expect(shell.description).toContain('no sudo')
    expect(tools.find((tool) => tool.name === 'read')!.description).toContain(mac.root)
    expect(tools.find((tool) => tool.name === 'read')!.description).not.toContain('disposable')
  })

  it('tells the model to use PowerShell syntax on Windows', () => {
    const shell = workspaceToolText(windows).shell
    expect(shell).toContain('PowerShell')
    expect(shell).toContain('Use PowerShell syntax')
    expect(shell).not.toContain('must stay inside')
  })

  it('still sends the bash operation type so the desktop runner stays wire-compatible', async () => {
    const calls: string[] = []
    const workspace = { descriptor: mac, execute: async (_id: string, type: string) => { calls.push(type); return { id: 'x', status: 'completed', output: 'ok', exitCode: 0 } } } as unknown as AgentWorkspace
    const shell = createWorkspaceTools(workspace, 1_000).find((tool) => tool.name === 'shell')!
    await shell.execute('call', { command: 'echo hi' }, undefined as never, undefined as never)
    expect(calls).toEqual(['bash'])
  })
})
