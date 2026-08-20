import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2 } from 'lucide-react'
import { AI_ICONS, isAiIconAvailable } from '@/lib/ai-icons'
import { apiRequest } from '@/lib/api'
import { AiLogo } from '@/components/ProviderLogo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useCatalog } from '@/stores/catalog'
import { useCatalogIcons } from '@/stores/catalogIcons'
import type { AdminCatalogIcon } from '@/lib/catalog-icons'

type Draft = {
  id?: string
  name: string
  logo: string
  customIconId: string | null
}

interface AdminLab {
  id: string
  name: string
  logo: string
  customIconId: string | null
  modelCount: number
  builtin: boolean
  models: Array<{
    id: string
    name: string
    logo: string | null
    customIconId: string | null
    enabled: boolean
    visible: boolean
    sortOrder: number
  }>
}

const emptyDraft = (): Draft => ({
  name: '',
  logo: 'pulpo',
  customIconId: null,
})

const LAB_ICONS = AI_ICONS.filter((icon) => isAiIconAvailable(icon, 'lab') && !icon.color)

export function AdminLabsPage() {
  const [labs, setLabs] = useState<AdminLab[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const customIcons = useCatalogIcons((state) => state.icons)
  const loadIcons = useCatalogIcons((state) => state.load)

  const load = async () => {
    const result = await apiRequest<{ data: AdminLab[] }>('/api/admin/labs')
    setLabs(result.data)
  }
  useEffect(() => { void Promise.all([load(), loadIcons()]) }, [loadIcons])

  const openAdd = () => setDraft(emptyDraft())

  const openEdit = (lab: AdminLab) => {
    setDraft({ id: lab.id, name: lab.name, logo: lab.logo, customIconId: lab.customIconId })
  }

  const save = async () => {
    if (!draft?.name.trim()) return
    if (draft.id) {
      await apiRequest(`/api/admin/labs/${draft.id}`, { method: 'PATCH', body: { name: draft.name.trim(), logo: draft.logo, customIconId: draft.customIconId } })
    } else {
      await apiRequest('/api/admin/labs', { method: 'POST', body: { name: draft.name.trim(), logo: draft.logo, customIconId: draft.customIconId } })
    }
    setDraft(null)
    await Promise.all([load(), useCatalog.getState().load()])
  }

  const remove = async (id: string) => {
    await apiRequest(`/api/admin/labs/${id}`, { method: 'DELETE' })
    await Promise.all([load(), useCatalog.getState().load()])
  }

  const moveModel = async (lab: AdminLab, index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= lab.models.length) return
    const reordered = [...lab.models]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    setLabs((current) => current.map((item) => item.id === lab.id ? { ...item, models: reordered } : item))
    try {
      await apiRequest(`/api/admin/labs/${lab.id}/models/order`, {
        method: 'PUT',
        body: { modelIds: reordered.map((model) => model.id) },
      })
      await useCatalog.getState().load()
    } catch (error) {
      await load()
      throw error
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Labs</h2>
        <Badge variant="secondary">{labs.length}</Badge>
        <div className="flex-1" />
        <Button size="sm" onClick={openAdd}>
          <Plus />
          Add lab
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Company marks shown in the model picker. Use the arrows to set the order of models within each lab.
      </p>

      <Card className="gap-0 rounded-lg py-0 shadow-none">
        <CardContent className="overflow-x-auto px-0 py-0">
          <table className="data-table">
            <thead>
              <tr className="border-b">
                <th className="px-3 py-2">Lab</th>
                <th className="px-3 py-2">Logo</th>
                <th className="px-3 py-2">Models</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {labs.map((lab) => (
                <tr key={lab.id}>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-3">
                      <AiLogo icon={lab.logo} customIcon={findCustomIcon(customIcons, lab.customIconId)} className="size-5" />
                      <span className="font-medium">{lab.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                      {lab.logo}
                    </code>
                  </td>
                  <td className="px-3 py-2">
                    {lab.models.length ? (
                      <div className="min-w-64 space-y-1">
                        {lab.models.map((model, index) => (
                          <div key={model.id} className="flex items-center gap-2 rounded-md border bg-muted/20 px-2 py-1.5">
                            <AiLogo
                              icon={model.logo ?? lab.logo}
                              customIcon={findCustomIcon(customIcons, model.customIconId) ?? (model.logo ? null : findCustomIcon(customIcons, lab.customIconId))}
                              className="size-4"
                            />
                            <span className="min-w-0 flex-1 truncate font-medium">{model.name}</span>
                            {(!model.enabled || !model.visible) && (
                              <Badge variant="outline" className="text-[10px] font-normal">
                                {!model.enabled ? 'Disabled' : 'Hidden'}
                              </Badge>
                            )}
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              title={`Move ${model.name} up`}
                              aria-label={`Move ${model.name} up`}
                              disabled={index === 0}
                              onClick={() => void moveModel(lab, index, -1)}
                            >
                              <ArrowUp className="size-3.5" />
                            </Button>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              title={`Move ${model.name} down`}
                              aria-label={`Move ${model.name} down`}
                              disabled={index === lab.models.length - 1}
                              onClick={() => void moveModel(lab, index, 1)}
                            >
                              <ArrowDown className="size-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">No linked models</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {lab.builtin ? <div className="flex justify-end"><Badge variant="outline">Built-in</Badge></div> : <div className="flex justify-end gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Edit"
                        onClick={() => openEdit(lab)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        title="Delete"
                        className="hover:text-destructive"
                        onClick={() => void remove(lab.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>}
                  </td>
                </tr>
              ))}
              {!labs.length && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-muted-foreground">
                    No labs yet. Add one to associate with models.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!draft} onOpenChange={(v) => !v && setDraft(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Edit lab' : 'Add lab'}</DialogTitle>
          </DialogHeader>
          {draft && (
            <div className="space-y-3.5">
              <div className="space-y-1.5">
                <Label htmlFor="lab-name">Name</Label>
                <Input
                  id="lab-name"
                  placeholder="OpenAI"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Logo</Label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="group/tile relative mt-0.5 flex aspect-[2/1] w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg border bg-muted/25 transition-colors hover:bg-accent"
                    >
                      <AiLogo
                        icon={draft.logo}
                        customIcon={findCustomIcon(customIcons, draft.customIconId)}
                        className="size-14 transition-transform duration-150 group-hover/tile:scale-105"
                      />
                      <Badge variant="secondary" className="absolute bottom-2 right-2 font-normal">
                        lab
                      </Badge>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-[336px] overflow-y-auto p-2"
                  >
                    <div className="mb-2 px-1 text-xs font-medium text-muted-foreground">
                      Choose a lab logo
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {LAB_ICONS.map((icon) => (
                        <button
                          key={icon.id}
                          type="button"
                          onClick={() => setDraft({ ...draft, logo: icon.id, customIconId: null })}
                          className={cn(
                            'relative flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md p-2 text-[10px] transition-colors hover:bg-accent',
                            !draft.customIconId && draft.logo === icon.id && 'bg-accent ring-1 ring-border'
                          )}
                          title={icon.label}
                        >
                          <AiLogo icon={icon.id} className="size-7" />
                          <span className="w-full truncate">{icon.label}</span>
                          {!draft.customIconId && draft.logo === icon.id && (
                            <Check className="absolute right-1 top-1 size-3 text-primary" />
                          )}
                        </button>
                      ))}
                    </div>
                    {!!customIcons.length && <>
                      <div className="mb-2 mt-3 border-t px-1 pt-3 text-xs font-medium text-muted-foreground">Custom icons</div>
                      <div className="grid grid-cols-4 gap-1">
                        {customIcons.map((icon) => <button
                          key={icon.id}
                          type="button"
                          onClick={() => setDraft({ ...draft, logo: 'pulpo', customIconId: icon.id })}
                          className={cn('relative flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md p-2 text-[10px] transition-colors hover:bg-accent', draft.customIconId === icon.id && 'bg-accent ring-1 ring-border')}
                          title={icon.name}
                        >
                          <AiLogo icon="pulpo" customIcon={icon} className="size-7" />
                          <span className="w-full truncate">{icon.name}</span>
                          {draft.customIconId === icon.id && <Check className="absolute right-1 top-1 size-3 text-primary" />}
                        </button>)}
                      </div>
                    </>}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={!draft?.name.trim()}>
              {draft?.id ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function findCustomIcon(icons: AdminCatalogIcon[], id: string | null | undefined) {
  return icons.find((icon) => icon.id === id) ?? null
}
