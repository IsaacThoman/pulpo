import { useEffect, useState } from 'react'
import { Check, Pencil, Plus, Trash2 } from 'lucide-react'
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

type Draft = {
  id?: string
  name: string
  logo: string
}

interface AdminLab {
  id: string
  name: string
  logo: string
  modelCount: number
  builtin: boolean
}

const emptyDraft = (): Draft => ({
  name: '',
  logo: 'openai',
})

const LAB_ICONS = AI_ICONS.filter((icon) => isAiIconAvailable(icon, 'lab') && !icon.color)

export function AdminLabsPage() {
  const [labs, setLabs] = useState<AdminLab[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)

  const load = async () => {
    const result = await apiRequest<{ data: AdminLab[] }>('/api/admin/labs')
    setLabs(result.data)
  }
  useEffect(() => { void load() }, [])

  const openAdd = () => setDraft(emptyDraft())

  const openEdit = (lab: AdminLab) => {
    setDraft({ id: lab.id, name: lab.name, logo: lab.logo })
  }

  const save = async () => {
    if (!draft?.name.trim()) return
    if (draft.id) {
      await apiRequest(`/api/admin/labs/${draft.id}`, { method: 'PATCH', body: { name: draft.name.trim(), logo: draft.logo } })
    } else {
      await apiRequest('/api/admin/labs', { method: 'POST', body: { name: draft.name.trim(), logo: draft.logo } })
    }
    setDraft(null)
    await Promise.all([load(), useCatalog.getState().load()])
  }

  const remove = async (id: string) => {
    await apiRequest(`/api/admin/labs/${id}`, { method: 'DELETE' })
    await Promise.all([load(), useCatalog.getState().load()])
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
        Company marks shown in the model picker and associated with models.
      </p>

      <Card className="shadow-none">
        <CardContent className="px-0 py-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Lab</th>
                <th className="px-4 py-2.5 font-medium">Logo</th>
                <th className="px-4 py-2.5 font-medium">Linked models</th>
                <th className="px-5 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {labs.map((lab) => (
                <tr key={lab.id} className="border-b last:border-0">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <AiLogo icon={lab.logo} className="size-5" />
                      <span className="font-medium">{lab.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                      {lab.logo}
                    </code>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {lab.modelCount}
                  </td>
                  <td className="px-5 py-3">
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
                  <td colSpan={4} className="px-5 py-10 text-center text-muted-foreground">
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
                          onClick={() => setDraft({ ...draft, logo: icon.id })}
                          className={cn(
                            'relative flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md p-2 text-[10px] transition-colors hover:bg-accent',
                            draft.logo === icon.id && 'bg-accent ring-1 ring-border'
                          )}
                          title={icon.label}
                        >
                          <AiLogo icon={icon.id} className="size-7" />
                          <span className="w-full truncate">{icon.label}</span>
                          {draft.logo === icon.id && (
                            <Check className="absolute right-1 top-1 size-3 text-primary" />
                          )}
                        </button>
                      ))}
                    </div>
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
