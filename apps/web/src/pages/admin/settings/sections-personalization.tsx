import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { personalizationSettingsSchema, type InstructionPreset, type PersonalizationSettings } from '@pulpo/contracts'
import { Section, SaveBar } from '@/components/admin/kit'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { apiRequest } from '@/lib/api'
import { cn } from '@/lib/utils'
import { queryClient } from '@/lib/query-client'
import { moveInstructionPreset } from './personalization-presets-logic'
import { ui, uit } from '@/i18n/ui'

const DEFAULT_COLOR = '#8b5cf6'
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

export function PersonalizationSection() {
  const [presets, setPresets] = useState<InstructionPreset[]>([])

  useEffect(() => {
    void apiRequest<{ values: { personalization?: PersonalizationSettings } }>('/api/admin/settings')
      .then((result) => setPresets(personalizationSettingsSchema.parse(
        result.values.personalization ?? {},
      ).instructionPresets))
  }, [])

  const update = (index: number, patch: Partial<InstructionPreset>) => {
    setPresets((current) => current.map((preset, itemIndex) => (
      itemIndex === index ? { ...preset, ...patch } : preset
    )))
  }

  const add = () => {
    setPresets((current) => [...current, {
      id: crypto.randomUUID(),
      title: ui("New preset"),
      instructions: 'Add custom instructions for this preset.',
      color: DEFAULT_COLOR,
      defaultEnabled: false,
    }])
  }

  const save = async () => {
    await apiRequest('/api/admin/settings', {
      method: 'PATCH',
      body: { personalization: { instructionPresets: presets } },
    })
    await queryClient.invalidateQueries({ queryKey: ['settings'] })
  }

  return (
    <div>
      <Section
        title={ui("Custom-instruction presets")}
        hint="Shown as toggle buttons above each user's custom instructions. List order also controls instruction order."
      >
        {presets.length === 0 && (
          <div className="text-sm text-muted-foreground">{ui("No presets configured.")}</div>
        )}
        {presets.map((preset, index) => {
          const colorValid = HEX_COLOR.test(preset.color)
          return (
            <div key={preset.id} className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
                    <div>
                      <div className="mb-1 text-xs text-muted-foreground">{ui("Button title")}</div>
                      <Input
                        value={preset.title}
                        maxLength={80}
                        onChange={(event) => update(index, { title: event.target.value })}
                      />
                    </div>
                    <div>
                      <div className="mb-1 text-xs text-muted-foreground">{ui("Accent color")}</div>
                      <div className="flex gap-2">
                        <input
                          type="color"
                          aria-label={uit`Choose ${preset.title || 'preset'} color`}
                          value={colorValid ? preset.color : DEFAULT_COLOR}
                          onChange={(event) => update(index, { color: event.target.value })}
                          className="h-9 w-10 cursor-pointer rounded-md border bg-background p-1"
                        />
                        <Input
                          aria-label={uit`${preset.title || 'Preset'} hex color`}
                          className={cn('font-mono text-xs', !colorValid && 'border-destructive')}
                          value={preset.color}
                          maxLength={7}
                          onChange={(event) => update(index, { color: event.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">{ui("Instructions")}</div>
                    <Textarea
                      rows={7}
                      value={preset.instructions}
                      maxLength={100_000}
                      onChange={(event) => update(index, { instructions: event.target.value })}
                      placeholder={ui("Prepended when this preset is enabled.")}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2">
                    <div>
                      <div className="text-sm">{ui("Enabled by default")}</div>
                      <div className="text-xs text-muted-foreground">{ui("Applies only while a user has no explicit choice for this preset.")}</div>
                    </div>
                    <Switch
                      checked={preset.defaultEnabled}
                      onCheckedChange={(value) => update(index, { defaultEnabled: value })}
                    />
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={uit`Move ${preset.title || 'preset'} up`}
                    disabled={index === 0}
                    onClick={() => setPresets((current) => moveInstructionPreset(current, index, -1))}
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={uit`Move ${preset.title || 'preset'} down`}
                    disabled={index === presets.length - 1}
                    onClick={() => setPresets((current) => moveInstructionPreset(current, index, 1))}
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={uit`Delete ${preset.title || 'preset'}`}
                    onClick={() => setPresets((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
        {presets.length < 50 && (
          <div>
            <Button type="button" variant="outline" size="sm" onClick={add}>
              <Plus className="size-3.5" /> {ui("Add preset")} </Button>
          </div>
        )}
      </Section>
      <SaveBar onSave={save} />
    </div>
  )
}
