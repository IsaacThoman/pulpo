import {
  Archive, ArrowUp, Bot, Brain, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Copy, FileText, Folder, FolderDown, FolderPlus, Gauge, Ghost, Globe,
  Hourglass, ImageIcon, Lock, Mic, PanelLeft, Paperclip, Plus, Search, Server, Share, ShieldCheck, Square, SquarePen, Star, Terminal, Wrench,
} from 'lucide-react'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { MarkdownLite } from './MarkdownLite'
import { followsNewest, responseParts } from './response'
import { modelById, type CompiledScene, type DemoFrame, type DemoStep, type DemoTimeline, type DeviceFrame } from './timeline'

// Sizes between Tailwind's steps, in the canvas's scaled units (see .landing-device-canvas).
export const T11 = 'text-[length:calc(var(--spacing)*2.75)]'
export const T13 = 'text-[length:calc(var(--spacing)*3.25)]'
export const T15 = 'text-[length:calc(var(--spacing)*3.75)]'

/** A mark from public/ai-icons. Single-color marks are black, so they are inverted on dark backgrounds. */
export function ModelMark({ icon, className }: { icon: string; className?: string }) {
  return <img src={`/ai-icons/${icon}`} alt="" className={cn(!icon.endsWith('-color.svg') && 'dark:invert', className)} />
}

function Sidebar({ script, activeTitle }: { script: DemoTimeline['script']; activeTitle: string | null }) {
  const links = [
    { icon: SquarePen, label: ui("New chat") },
    { icon: Search, label: ui("Search") },
    { icon: Folder, label: ui("Files") },
  ]
  return (
    <aside className="flex w-66 shrink-0 flex-col border-r bg-sidebar max-sm:hidden">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <img src="/pulpo-smiley.png" alt="" className="size-6" />
        <span className={cn('font-semibold', T15)}>Pulpo</span>
        <PanelLeft className="ml-auto size-4 text-muted-foreground" />
      </div>
      <div className={cn('flex shrink-0 flex-col px-2', T15)}>
        {links.map((link) => (
          <span key={link.label} className="flex h-8.5 items-center gap-2 px-2"><link.icon className="size-4" />{link.label}</span>
        ))}
      </div>
      <div className={cn('mt-3 flex shrink-0 items-center justify-between px-4 font-medium tracking-wide text-muted-foreground uppercase', T11)}>
        {ui("Default")}<FolderPlus className="size-3.5" />
      </div>
      <ul className={cn('mt-1.5 flex min-h-0 flex-1 flex-col overflow-hidden px-2', T15)}>
        {activeTitle === null ? null : (
          <li className="flex h-8.5 shrink-0 items-center rounded-md bg-sidebar-accent px-2"><span className="truncate">{activeTitle}</span></li>
        )}
        {script.sidebar.map((title) => (
          <li key={title} className="flex h-8.5 shrink-0 items-center px-2"><span className="truncate">{title}</span></li>
        ))}
      </ul>
      <div className="flex shrink-0 items-center gap-2.5 border-t px-3 py-3">
        <span className={cn('flex size-7 items-center justify-center rounded-full bg-muted font-medium', T11)}>{script.user.initials}</span>
        <span className="min-w-0 leading-tight">
          <span className={cn('block truncate font-medium', T15)}>{script.user.name}</span>
          <span className="block text-xs text-muted-foreground">@{script.user.username}</span>
        </span>
      </div>
    </aside>
  )
}

const TOOL_ICONS: Record<string, typeof Terminal> = { bash: Terminal, read: FileText, attach_file: Paperclip, view_image: ImageIcon, web_search: Search, web_fetch: Globe }

function Step({ step }: { step: DemoStep }) {
  const duration = <span className="ml-auto shrink-0 pl-3 font-mono text-xs">{step.duration}</span>
  if (step.kind === 'reasoning') {
    return (
      <div className="py-1">
        <div className="flex items-baseline"><span className="font-semibold">{step.title}</span>{duration}</div>
        <p className="mt-0.5 line-clamp-2 leading-snug">{step.text}</p>
      </div>
    )
  }
  if (step.kind === 'workspace') return <div className="flex h-7 items-center gap-2"><Server className="size-3.5 shrink-0" />{ui("Started workspace")}{duration}</div>
  const Icon = TOOL_ICONS[step.tool] ?? Wrench
  return (
    <div className="flex h-7 items-center gap-2">
      <Icon className="size-3.5 shrink-0" />
      <span className="font-medium text-foreground">{step.tool}</span>
      <span className="min-w-0 truncate font-mono text-xs">{step.detail}</span>
      {duration}
      <ChevronRight className="-ml-0.5 size-3 shrink-0" />
    </div>
  )
}

function Chat({ compiled, device, roomy, expanded }: { compiled: CompiledScene; device: DeviceFrame; roomy: boolean; expanded: boolean }) {
  const { steps, traced, pending, thinking, workLabel, attachment } = responseParts(compiled, device)
  const model = compiled.endModel
  // As in the app, the steps are listed while the agent works and fold away once it answers.
  const open = expanded || device.working
  return (
    // Reversed so that once the conversation outgrows the window, its newest part stays in view.
    <div className={cn('flex min-h-0 flex-1 overflow-hidden px-6 pt-5', followsNewest(compiled, device) ? 'flex-col-reverse' : 'flex-col', roomy && 'sm:px-12', T15)}>
      <div className="mb-auto pb-4">
        <div className="ml-auto w-fit max-w-[80%] rounded-2xl border bg-secondary/70 px-4 py-2.5">{compiled.prompt}</div>
        <div className="mt-8 flex gap-3">
          <ModelMark icon={model.icon} className="mt-0.5 size-7 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="font-semibold">{model.name}</span>
              <span className="text-xs text-muted-foreground">{ui("now")}</span>
            </div>
            {traced ? (
              <div className={cn('mt-1 text-muted-foreground', T13)}>
                <div className={cn('flex items-center gap-1.5', device.working && 'animate-pulse')}>
                  {thinking ? <Brain className="size-3.5" /> : <Wrench className="size-3.5" />}{workLabel}
                  <ChevronRight className={cn('size-3 transition-transform duration-200 motion-reduce:transition-none', open && 'rotate-90')} />
                </div>
                {/* Folds away like the app's collapsibles (the composer tray: 200ms ease-out, height and opacity). */}
                <div className={cn('grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr] opacity-0')}>
                  <div className="min-h-0 overflow-hidden">
                    <div className="mt-1 ml-1.5 border-l pl-3">{steps.map((step, index) => <Step key={index} step={step} />)}</div>
                  </div>
                </div>
              </div>
            ) : pending ? (
              // The app's dots while nothing has arrived yet (MessageItem); "Thinking…" belongs to reasoning.
              <span className="mt-1 flex gap-1 py-1">
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
              </span>
            ) : null}
            {device.answer ? (
              <div className="mt-2 space-y-2 leading-[1.7]">
                <MarkdownLite text={device.answer} cursor={device.streaming} listClassName="list-disc space-y-1 pl-6 marker:text-muted-foreground" />
              </div>
            ) : null}
            {attachment ? (
              <div className="mt-3 w-76 overflow-hidden rounded-2xl border bg-card">
                <img src={attachment.src} alt="" width={attachment.width} height={attachment.height} loading="lazy" className="block h-auto w-full bg-white" />
                <div className="flex items-center justify-between gap-3 border-t px-3 py-2">
                  <span className="min-w-0 leading-tight">
                    <span className={cn('block truncate font-medium', T13)}>{attachment.name}</span>
                    <span className={cn('block text-muted-foreground', T11)}>{attachment.meta}</span>
                  </span>
                  <FolderDown className="size-4 shrink-0 text-muted-foreground" />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Pulpo's web app in a browser window: a new chat, then the conversation. `panel` is a narrower, taller
 * window without the sidebar, for showing one conversation in full with the agent's steps left open.
 */
export function WebMock({ timeline, frame, panel = false }: { timeline: DemoTimeline; frame: DemoFrame; panel?: boolean }) {
  const { script } = timeline
  const { web } = frame
  const compiled = timeline.scenes[frame.scene]!
  const model = modelById(script, web.modelId)
  const controls = model.controls ?? script.models[0]!.controls
  const picker = frame.picker?.on === 'web' ? frame.picker : null
  const caret = web.chat ? null : <span className="mx-px inline-block h-[1.15em] w-px translate-y-[0.2em] animate-pulse bg-foreground" />
  return (
    <div className="landing-device">
      <div className={cn('landing-device-canvas flex flex-col overflow-hidden rounded-[calc(var(--spacing)*3)] border bg-background shadow-2xl shadow-black/15 dark:shadow-black/60', panel ? 'aspect-[720/1020] [--dw:720]' : 'aspect-[640/520] [--dw:640] sm:aspect-[1152/772] sm:[--dw:1152]')}>
        <div className="flex h-13 shrink-0 items-center gap-5 border-b bg-muted/60 px-5 text-muted-foreground">
          <span className="flex w-18 shrink-0 gap-2">
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
          </span>
          <span className={cn('flex items-center gap-4', panel ? 'hidden' : 'max-sm:hidden')}>
            <PanelLeft className="size-4" /><ChevronLeft className="size-4.5" /><ChevronRight className="size-4.5 opacity-40" />
          </span>
          <span className={cn('mx-auto flex h-8 w-[44%] items-center justify-center gap-1.5 rounded-lg border bg-background/80', T13)}>
            <Lock className="size-3" />{'pulpo.baby'}
          </span>
          <span className={cn('flex items-center gap-4', panel ? 'hidden' : 'max-sm:hidden')}>
            <Share className="size-4" /><Plus className="size-4.5" /><Copy className="size-4" />
          </span>
          {/* Balances the window buttons so the address stays centered when the other controls are hidden. */}
          <span className={cn('w-18 shrink-0', !panel && 'sm:hidden')} />
        </div>
        <div className="flex min-h-0 flex-1" style={{ opacity: frame.opacity }}>
          {panel ? null : <Sidebar script={script} activeTitle={frame.sidebarTitle} />}
          <div className="relative flex min-w-0 flex-1 flex-col">
            <div className="flex h-12 shrink-0 items-center gap-2 px-4">
              <PanelLeft className={cn('mr-1 size-4 text-muted-foreground', !panel && 'sm:hidden')} />
              <span className={cn('-mx-2 flex h-8 items-center gap-2 rounded-md px-2', picker && 'bg-accent')}>
                <ModelMark icon={model.icon} className="size-5" />
                <span className={cn('font-medium', T15)}>{model.name}</span>
                {picker ? <ChevronUp className="size-3.5 text-muted-foreground" /> : <ChevronDown className="size-3.5 text-muted-foreground" />}
              </span>
              <span className="ml-auto flex items-center gap-5 text-muted-foreground">
                <Hourglass className="size-4" />{web.chat ? <SquarePen className="size-4" /> : <Ghost className="size-4" />}
              </span>
            </div>

            {picker ? (
              <div className={cn('absolute top-11 left-3 z-10 w-75 overflow-hidden rounded-xl border bg-popover shadow-xl shadow-black/15 dark:shadow-black/50', T15)}>
                <div className="flex h-10 items-center gap-2.5 border-b px-3.5 text-muted-foreground"><Search className="size-4" />{ui("Search models…")}</div>
                <div className="flex">
                  <div className="flex w-11 shrink-0 flex-col items-center gap-3.5 border-r py-3.5">
                    <Star className="size-4.5" />
                    <span className="h-px w-5 bg-border" />
                    {script.labs.map((icon) => <ModelMark key={icon} icon={icon} className="size-4.5 opacity-60" />)}
                  </div>
                  <div className="min-w-0 flex-1 p-1.5">
                    {script.models.map((candidate) => (
                      <div key={candidate.id} className={cn('flex h-10 items-center gap-2.5 rounded-md px-2.5', (picker.pressed ?? web.modelId) === candidate.id && 'bg-accent')}>
                        <ModelMark icon={candidate.icon} className="size-5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
                        <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-400" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {web.chat ? <Chat compiled={compiled} device={web} roomy={!panel} expanded={panel} /> : (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8">
                <div className="flex items-center gap-3">
                  <ModelMark icon={model.icon} className="size-11" />
                  <span className="text-3xl font-semibold tracking-tight">{model.name}</span>
                </div>
                <div className={cn('mt-1.5 flex items-center gap-1.5 text-muted-foreground', T15)}>{model.lab}<ShieldCheck className="size-3.5 text-green-500" /></div>
                <div className={cn('mt-6 grid w-full max-w-144 grid-cols-2 gap-2 leading-snug', T15)}>
                  {script.suggestions.map((suggestion) => (
                    <span key={suggestion} className="flex min-h-16 items-center rounded-xl border bg-card/50 px-4 py-2.5">{suggestion}</span>
                  ))}
                </div>
              </div>
            )}

            <div className={cn('shrink-0 px-6 pb-5', !panel && 'sm:px-12')}>
              <div className="rounded-2xl border bg-card px-4 pt-3 pb-2.5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <p className={cn('min-h-6 min-w-0', !web.draft && 'text-muted-foreground')}>
                    {web.draft ? null : caret}{web.draft || ui("Message…")}{web.draft ? caret : null}
                  </p>
                  {/* A send-button-wide box, as in the app, so the shelf icon centers over the send button. */}
                  <span className="-mt-1 flex size-8 shrink-0 items-center justify-center"><Archive className="size-4 text-muted-foreground/60" /></span>
                </div>
                <div className={cn('mt-1.5 flex items-center gap-4 text-muted-foreground', T13)}>
                  <Plus className="size-4.5" />
                  {controls?.reasoning ? <span className="flex items-center gap-1.5"><Brain className="size-3.5" />{controls.reasoning}</span> : null}
                  {controls?.speed ? <span className="flex items-center gap-1.5"><Gauge className="size-3.5" />{controls.speed}<ChevronUp className="size-3" /></span> : null}
                  {controls?.agent ? <span className="flex items-center gap-1.5"><Bot className="size-4" />{controls.agent}<ChevronUp className="size-3" /></span> : null}
                  <Mic className="ml-auto size-4" />
                  <span className={cn('flex size-8 items-center justify-center rounded-full', web.draft || (web.chat && web.streaming) ? 'bg-primary text-primary-foreground' : 'bg-muted-foreground/40 text-background')}>
                    {web.chat && web.streaming ? <Square className="size-3 fill-current" /> : <ArrowUp className="size-4" />}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
