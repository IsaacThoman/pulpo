import { useState } from 'react'
import { Download, Plus, Upload } from 'lucide-react'
import { TOOL_SERVERS } from '@/lib/mock-admin'
import { Field, SaveBar, Section, SecretField, SelectField, TextField } from '@/components/admin/kit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

export function IntegrationsSection() {
  const [servers, setServers] = useState(TOOL_SERVERS)

  const group = (kind: (typeof TOOL_SERVERS)[number]['kind'], title: string, hint: string) => (
    <Section title={title} hint={hint}>
      {servers
        .filter((s) => s.kind === kind)
        .map((s) => (
          <div key={s.id} className="flex items-center gap-3">
            <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2.5 py-1.5 font-mono text-xs">
              {s.url}
            </code>
            <Badge variant="outline">{s.name}</Badge>
            <Switch
              checked={s.enabled}
              onCheckedChange={(v) =>
                setServers((ss) => ss.map((x) => (x.id === s.id ? { ...x, enabled: v } : x)))
              }
            />
          </div>
        ))}
      <div>
        <Button variant="outline" size="sm">
          <Plus />
          Add connection
        </Button>
      </div>
    </Section>
  )

  return (
    <div>
      {group('tool', 'Tools', 'External OpenAPI / MCP tool servers available to models.')}
      {group('terminal', 'Open Terminal', 'Persistent terminal connections for agentic models.')}
      {group('knowledge', 'External knowledge', 'External vector databases queryable as knowledge sources.')}
      <Section title="Add knowledge connection">
        <SelectField
          label="Provider"
          value="qdrant"
          onChange={() => {}}
          options={[
            { value: 'qdrant', label: 'Qdrant' },
            { value: 'milvus', label: 'Milvus' },
            { value: 'pgvector', label: 'pgvector' },
          ]}
        />
        <TextField label="Endpoint" value="" onChange={() => {}} mono placeholder="https://:6333" />
        <SecretField label="API key / token" value="" onChange={() => {}} />
        <TextField label="Collection (source name)" value="" onChange={() => {}} />
        <TextField label="Test query" value="" onChange={() => {}} placeholder="must verify before saving" />
      </Section>
      <SaveBar />
    </div>
  )
}

export function DatabaseSection() {
  return (
    <div>
      <Section title="Config">
        <Field label="Import config" hint="Restore settings from a .json export.">
          <Button variant="outline" size="sm">
            <Upload />
            Import
          </Button>
        </Field>
        <Field label="Export config">
          <Button variant="outline" size="sm">
            <Download />
            Export
          </Button>
        </Field>
      </Section>

      <Section title="Database">
        <Field label="Download database" hint="Full sqlite dump — keep it somewhere safe.">
          <Button variant="outline" size="sm">
            <Download />
            Download
          </Button>
        </Field>
        <Field label="Export all chats (all users)">
          <Button variant="outline" size="sm">
            <Download />
            Export JSON
          </Button>
        </Field>
        <Field label="Export users">
          <Button variant="outline" size="sm">
            <Download />
            Export CSV
          </Button>
        </Field>
      </Section>

      <SaveBar />
    </div>
  )
}
