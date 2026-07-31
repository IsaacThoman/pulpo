import { Download } from 'lucide-react'
import { Field, Section } from '@/components/admin/kit'
import { Button } from '@/components/ui/button'
import { apiRequest } from '@/lib/api'

async function requestExport(type: 'config' | 'chats' | 'users' | 'usage'): Promise<void> {
  const job = await apiRequest<{ id: string }>('/api/admin/exports', { method: 'POST', body: { type } })
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    const result = await apiRequest<{ data: Array<{ id: string; status: string; error?: string }> }>('/api/admin/exports')
    const current = result.data.find((candidate) => candidate.id === job.id)
    if (current?.status === 'completed') {
      location.assign(`/api/admin/exports/${job.id}/download`)
      return
    }
    if (current?.status === 'failed') throw new Error(current.error ?? 'Export failed')
  }
  throw new Error('Export is still processing')
}

export function DatabaseSection() {
  return (
    <div>
      <Section title="Config">
        <Field label="Export config">
          <Button variant="outline" size="sm" onClick={() => void requestExport('config')}>
            <Download />
            Export
          </Button>
        </Field>
      </Section>

      <Section title="Database">
        <Field label="Database backups" hint="Use the documented PostgreSQL and object-storage backup commands for restorable operator backups.">
          <span className="text-xs text-muted-foreground">Logical data exports are available below.</span>
        </Field>
        <Field label="Export all chats (all users)">
          <Button variant="outline" size="sm" onClick={() => void requestExport('chats')}>
            <Download />
            Export JSON
          </Button>
        </Field>
        <Field label="Export users">
          <Button variant="outline" size="sm" onClick={() => void requestExport('users')}>
            <Download />
            Export CSV
          </Button>
        </Field>
      </Section>

      <Section title="Usage">
        <Field label="Export usage records">
          <Button variant="outline" size="sm" onClick={() => void requestExport('usage')}><Download />Export CSV</Button>
        </Field>
      </Section>
    </div>
  )
}
