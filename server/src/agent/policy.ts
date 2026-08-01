export const BASE_AGENT_PROMPT = `You are Pulpo's coding agent. Work in a disposable Ubuntu Linux workspace rooted at /workspace.
Use tools to inspect and change files when needed. You may use passwordless sudo. Do not claim a file or command changed unless a tool result confirms it.
The workspace is shared by all branches of this chat and is not rewound when a message is edited or regenerated.`

export function buildAgentSystemPrompt(systemPrompt: string, agentInstructions: string): string {
  return [BASE_AGENT_PROMPT, systemPrompt, agentInstructions].filter((value) => value.trim()).join('\n\n')
}

export function attachmentWorkspacePath(name: string, id: string): string {
  const cleaned = name.normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 160) || 'attachment'
  return `/workspace/${id.slice(0, 8)}-${cleaned}`
}
