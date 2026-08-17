export function formatWorkspaceDuration(milliseconds: number): string {
  if (milliseconds <= 0) return 'now'
  const seconds = Math.floor(milliseconds / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function formatWorkspaceDeadline(value: string | null, now: number): string {
  if (!value) return '—'
  const milliseconds = new Date(value).getTime() - now
  if (milliseconds > 0) return formatWorkspaceDuration(milliseconds)
  const overdue = formatWorkspaceDuration(Math.abs(milliseconds))
  return overdue === 'now' ? 'Due now' : `${overdue} overdue`
}

export function workspaceCount(value: number, singular: string): string {
  return `${value} ${value === 1 ? singular : `${singular}s`}`
}
