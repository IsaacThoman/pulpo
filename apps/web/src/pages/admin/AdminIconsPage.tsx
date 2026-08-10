import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Pencil, Trash2, Upload } from 'lucide-react'
import type { AdminCatalogIcon, CatalogIconMode } from '@/lib/catalog-icons'
import { apiRequest } from '@/lib/api'
import { useCatalogIcons } from '@/stores/catalogIcons'
import { useCatalog } from '@/stores/catalog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type EditDraft = { id: string; name: string; mode: CatalogIconMode }

export function AdminIconsPage() {
  const icons = useCatalogIcons((state) => state.icons)
  const load = useCatalogIcons((state) => state.load)
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadName, setUploadName] = useState('')
  const [uploadMode, setUploadMode] = useState<CatalogIconMode>('original')
  const [edit, setEdit] = useState<EditDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { void load() }, [load])

  const chooseFile = (file: File | null) => {
    setUploadFile(file)
    if (file && !uploadName) setUploadName(file.name.replace(/\.[^.]+$/, ''))
  }

  const upload = async () => {
    if (!uploadFile || !uploadName.trim()) return
    setBusy(true); setError('')
    try {
      const form = new FormData()
      form.append('name', uploadName.trim())
      form.append('mode', uploadMode)
      form.append('file', uploadFile)
      await apiRequest('/api/admin/catalog-icons', { method: 'POST', body: form })
      setUploadOpen(false); setUploadFile(null); setUploadName(''); setUploadMode('original')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed')
    } finally { setBusy(false) }
  }

  const saveEdit = async () => {
    if (!edit?.name.trim()) return
    setBusy(true); setError('')
    try {
      await apiRequest(`/api/admin/catalog-icons/${edit.id}`, {
        method: 'PATCH', body: { name: edit.name.trim(), mode: edit.mode },
      })
      setEdit(null)
      await Promise.all([load(), useCatalog.getState().load()])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Update failed')
    } finally { setBusy(false) }
  }

  const remove = async (icon: AdminCatalogIcon) => {
    if (icon.usage.total) return
    setError('')
    try {
      await apiRequest(`/api/admin/catalog-icons/${icon.id}`, { method: 'DELETE' })
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Delete failed')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Icons</h2>
        <Badge variant="secondary">{icons.length}</Badge>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setUploadOpen(true)}><Upload />Upload icon</Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Reusable artwork for labs and models. Upload PNG, JPEG, or WebP images up to 2 MiB.
      </p>
      {error && <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</div>}

      {icons.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {icons.map((icon) => <IconCard key={icon.id} icon={icon} onEdit={() => setEdit({ id: icon.id, name: icon.name, mode: icon.mode })} onDelete={() => void remove(icon)} />)}
        </div>
      ) : (
        <Card className="shadow-none"><CardContent className="grid place-items-center py-14 text-center">
          <ImagePlus className="size-8 text-muted-foreground" />
          <div className="mt-3 text-sm font-medium">No custom icons yet</div>
          <div className="mt-1 text-xs text-muted-foreground">Upload an icon, then assign it from a lab or model editor.</div>
        </CardContent></Card>
      )}

      <Dialog open={uploadOpen} onOpenChange={(open) => { if (!busy) setUploadOpen(open) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Upload icon</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
            <button type="button" className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed px-4 py-8 hover:bg-accent/50" onClick={() => fileInput.current?.click()}>
              <Upload className="size-6 text-muted-foreground" />
              <span className="mt-2 text-sm font-medium">{uploadFile?.name ?? 'Choose an image'}</span>
              <span className="mt-1 text-xs text-muted-foreground">The image is fitted into a transparent square.</span>
            </button>
            <div className="space-y-1.5"><Label htmlFor="icon-name">Name</Label><Input id="icon-name" value={uploadName} maxLength={120} onChange={(event) => setUploadName(event.target.value)} /></div>
            <ModeField value={uploadMode} onChange={setUploadMode} />
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setUploadOpen(false)} disabled={busy}>Cancel</Button><Button onClick={() => void upload()} disabled={busy || !uploadFile || !uploadName.trim()}>Upload</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!edit} onOpenChange={(open) => { if (!open && !busy) setEdit(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Edit icon</DialogTitle></DialogHeader>
          {edit && <div className="space-y-4">
            <div className="space-y-1.5"><Label htmlFor="edit-icon-name">Name</Label><Input id="edit-icon-name" value={edit.name} maxLength={120} onChange={(event) => setEdit({ ...edit, name: event.target.value })} /></div>
            <ModeField value={edit.mode} onChange={(mode) => setEdit({ ...edit, mode })} />
          </div>}
          <DialogFooter><Button variant="outline" onClick={() => setEdit(null)} disabled={busy}>Cancel</Button><Button onClick={() => void saveEdit()} disabled={busy || !edit?.name.trim()}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
function IconCard({ icon, onEdit, onDelete }: { icon: AdminCatalogIcon; onEdit: () => void; onDelete: () => void }) {
  return <Card className="overflow-hidden shadow-none">
    <div className="grid grid-cols-2 border-b">
      <div className="grid h-28 place-items-center bg-white"><img src={icon.lightUrl} alt="" className="size-16 object-contain" /></div>
      <div className="grid h-28 place-items-center bg-zinc-950"><img src={icon.darkUrl} alt="" className="size-16 object-contain" /></div>
    </div>
    <CardContent className="p-3">
      <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{icon.name}</div><div className="mt-1 flex gap-1"><Badge variant="outline" className="font-normal">{icon.mode}</Badge><Badge variant="secondary" className="font-normal">{icon.usage.total} uses</Badge></div></div>
        <Button size="icon-sm" variant="ghost" title="Edit icon" onClick={onEdit}><Pencil className="size-3.5" /></Button>
        <Button size="icon-sm" variant="ghost" title={icon.usage.total ? 'Icon is in use' : 'Delete icon'} disabled={icon.usage.total > 0} className="hover:text-destructive" onClick={onDelete}><Trash2 className="size-3.5" /></Button>
      </div>
      {icon.usage.total > 0 && <div className="mt-2 text-[11px] text-muted-foreground">{icon.usage.labs} labs · {icon.usage.models} models</div>}
    </CardContent>
  </Card>
}

function ModeField({ value, onChange }: { value: CatalogIconMode; onChange: (value: CatalogIconMode) => void }) {
  return <div className="space-y-1.5"><Label>Appearance</Label><Select value={value} onValueChange={(mode: CatalogIconMode) => onChange(mode)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="original">Original color</SelectItem><SelectItem value="monochrome">Monochrome · adapts to theme</SelectItem></SelectContent></Select><p className="text-[11px] text-muted-foreground">Monochrome uses the artwork as a silhouette and switches between black and white.</p></div>
}
