import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { PROJECT_TEXT_MAX_LENGTH, type FileNode, type FileProject } from '@pulpo/contracts'
import { FolderKanban, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ui, uit } from '@/i18n/ui'
import { ApiError } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { useAuth } from '@/stores/auth'
import { useCatalog } from '@/stores/catalog'
import { relatedChatsQueryKey } from '@/features/chat/related-chats'
import { useFileToasts } from './browser/toasts'
import { filesErrorMessage } from './file-display'
import { editProject, fetchFolderProject, folderProjectQueryKey, removeFolderProject, saveFolderProject, useFolderProject, useProjectEditor } from './project'

/** "Same as chat" in the thread model list: threads use the model of the chat that starts them. */
const SAME_AS_CHAT = 'same-as-chat'

/** The folder menu item that opens a folder's project settings, or makes it a project. */
export function ProjectMenuItem({ folder }: { folder: Pick<FileNode, 'id' | 'name'> }) {
  // Asked only while the menu is open, rather than for every folder listed.
  const project = useFolderProject(folder.id).data
  return (
    <DropdownMenuItem onSelect={() => editProject(folder)}>
      <FolderKanban />
      {project ? ui('Project settings…') : ui('Make into project…')}
    </DropdownMenuItem>
  )
}

/** A folder's project settings: its instructions, memory, and thread model. Rendered once, by the Sidebar. */
export function ProjectDialog() {
  const folder = useProjectEditor((state) => state.folder)
  const [busy, setBusy] = useState(false)
  const close = () => { if (!busy) useProjectEditor.setState({ folder: null }) }
  return (
    <Dialog open={Boolean(folder)} onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className="sm:max-w-lg">
        {folder && <ProjectLoader key={folder.id} folder={folder} busy={busy} setBusy={setBusy} onDone={() => useProjectEditor.setState({ folder: null })} />}
      </DialogContent>
    </Dialog>
  )
}

function ProjectLoader({ folder, busy, setBusy, onDone }: {
  folder: { id: string; name: string }
  busy: boolean
  setBusy: (busy: boolean) => void
  onDone: () => void
}) {
  const userId = useAuth((state) => state.user?.id)
  const queryClient = useQueryClient()
  // Always read the latest memory: the agent may have changed it since the menu asked.
  const [loaded, setLoaded] = useState<{ project: FileProject | null; version: number } | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setError('')
    try {
      const project = await queryClient.fetchQuery({
        queryKey: folderProjectQueryKey(userId, folder.id),
        queryFn: ({ signal }) => fetchFolderProject(folder.id, signal),
        staleTime: 0,
      })
      setLoaded((current) => ({ project, version: (current?.version ?? 0) + 1 }))
    } catch (cause) {
      setError(filesErrorMessage(cause))
    }
  }, [folder.id, queryClient, userId])
  useEffect(() => { void load() }, [load])
  if (!loaded) {
    return (
      <>
        <ProjectHeader name={folder.name} existing={false} />
        {error
          ? <p role="alert" className="text-sm text-destructive">{error}</p>
          : <div role="status" className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{ui('Loading…')}</div>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>{ui('Cancel')}</Button>
          {error && <Button type="button" onClick={() => void load()}>{ui('Try again')}</Button>}
        </DialogFooter>
      </>
    )
  }
  return (
    <ProjectForm
      key={loaded.version}
      folder={folder}
      project={loaded.project}
      busy={busy}
      setBusy={setBusy}
      onReload={() => void load()}
      onDone={onDone}
    />
  )
}

function ProjectHeader({ name, existing }: { name: string; existing: boolean }) {
  return (
    <DialogHeader>
      <DialogTitle className="flex min-w-0 items-center gap-2">
        <FolderKanban className="size-5 shrink-0" />
        <span className="truncate">{existing ? uit`Project settings for "${name}"` : uit`Make "${name}" a project`}</span>
      </DialogTitle>
      <DialogDescription>
        {ui('Chats in this folder and its subfolders, with their side chats and threads, start with the project instructions and memory.')}
      </DialogDescription>
    </DialogHeader>
  )
}

function Counter({ value }: { value: string }) {
  return (
    <span className="text-xs tabular-nums text-muted-foreground">
      {formatNumber(value.length)} / {formatNumber(PROJECT_TEXT_MAX_LENGTH)}
    </span>
  )
}

function ProjectForm({ folder, project, busy, setBusy, onReload, onDone }: {
  folder: { id: string; name: string }
  project: FileProject | null
  busy: boolean
  setBusy: (busy: boolean) => void
  onReload: () => void
  onDone: () => void
}) {
  const userId = useAuth((state) => state.user?.id)
  const queryClient = useQueryClient()
  const models = useCatalog((state) => state.models)
  const [instructions, setInstructions] = useState(project?.instructions ?? '')
  const [memory, setMemory] = useState(project?.memory ?? '')
  const [threadModelId, setThreadModelId] = useState<string | null>(project?.threadModelId ?? null)
  const [error, setError] = useState('')
  const [memoryConflict, setMemoryConflict] = useState(false)
  // Threads run in agent mode, so only models that can be agents are offered.
  const threadModels = models.filter((model) => model.agentEnabled && !model.id.startsWith('codex:'))
  const selectedUnavailable = threadModelId !== null && !threadModels.some((model) => model.id === threadModelId)
  const name = project?.name ?? folder.name

  const settled = async (next: FileProject | null) => {
    queryClient.setQueryData(folderProjectQueryKey(userId, folder.id), next)
    // Chats show the project they belong to.
    await queryClient.invalidateQueries({ queryKey: relatedChatsQueryKey(userId) })
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    setMemoryConflict(false)
    const memoryChanged = memory !== (project?.memory ?? '')
    try {
      const saved = await saveFolderProject(folder.id, {
        instructions,
        threadModelId,
        // Sent only when changed, so a save does not overwrite what the agent wrote meanwhile.
        ...(memoryChanged ? { memory, expectedMemoryRevision: project?.memoryRevision ?? 0 } : {}),
      })
      await settled(saved)
      if (!project) useFileToasts.getState().show({ message: uit`"${name}" is now a project` })
      onDone()
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'project_memory_conflict') {
        setMemoryConflict(true)
      } else {
        setError(filesErrorMessage(cause))
      }
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    if (busy || !project) return
    setBusy(true)
    setError('')
    try {
      await removeFolderProject(folder.id)
      await settled(null)
      useFileToasts.getState().show({ message: uit`"${name}" is no longer a project` })
      onDone()
    } catch (cause) {
      setError(filesErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="min-w-0 space-y-4" onSubmit={(event) => void submit(event)}>
      <ProjectHeader name={name} existing={Boolean(project)} />
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="project-instructions">{ui('Instructions')}</Label>
          <Counter value={instructions} />
        </div>
        <Textarea
          id="project-instructions"
          className="max-h-48 min-h-24"
          placeholder={ui('How chats in this project should work: goals, conventions, what to avoid.')}
          value={instructions}
          maxLength={PROJECT_TEXT_MAX_LENGTH}
          disabled={busy}
          autoFocus
          onChange={(event) => setInstructions(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <Label htmlFor="project-memory">{ui('Memory')}</Label>
          <Counter value={memory} />
        </div>
        <Textarea
          id="project-memory"
          className="max-h-48 min-h-24 font-mono text-xs md:text-xs"
          placeholder={ui('Notes the agent keeps as it works in this project. You can edit them too.')}
          value={memory}
          maxLength={PROJECT_TEXT_MAX_LENGTH}
          disabled={busy}
          aria-invalid={memoryConflict}
          aria-describedby={memoryConflict ? 'project-memory-conflict' : 'project-memory-help'}
          onChange={(event) => { setMemory(event.target.value); setMemoryConflict(false) }}
        />
        {memoryConflict ? (
          <div id="project-memory-conflict" role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
            <span>{ui('The memory changed since you opened it. Reload to see the latest memory, then make your change again.')}</span>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onReload}>{ui('Reload')}</Button>
          </div>
        ) : (
          <p id="project-memory-help" className="text-xs text-muted-foreground">{ui('The agent keeps this up to date in agent mode.')}</p>
        )}
      </div>
      <div className="space-y-2">
        <Label id="project-thread-model-label">{ui('Thread model')}</Label>
        <Select
          value={threadModelId ?? SAME_AS_CHAT}
          onValueChange={(value) => setThreadModelId(value === SAME_AS_CHAT ? null : value)}
          disabled={busy}
        >
          <SelectTrigger aria-labelledby="project-thread-model-label" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={SAME_AS_CHAT}>{ui('Same as chat')}</SelectItem>
            {selectedUnavailable && <SelectItem value={threadModelId} disabled>{ui('Selected model unavailable')}</SelectItem>}
            {threadModels.map((model) => <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{ui('The model for threads that chats in this project start.')}</p>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter className="gap-2 sm:justify-between">
        {project ? (
          <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => void stop()}>
            {ui('Stop using as project')}
          </Button>
        ) : <span />}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" disabled={busy} onClick={onDone}>{ui('Cancel')}</Button>
          <Button type="submit" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            {project ? ui('Save') : ui('Make project')}
          </Button>
        </div>
      </DialogFooter>
    </form>
  )
}
