import { Download, Upload } from 'lucide-react'
import { Field, SaveBar, Section } from '@/components/admin/kit'
import { Button } from '@/components/ui/button'

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
