import type { ReactNode } from 'react'
import {
  AudioLines, Check, Cpu, Download, Files, GraduationCap, ImageIcon, KeyRound, Link2, Plug, Search, ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ui } from '@/i18n/ui'
import { APP_STORE_URL, DOCS_URL, GITHUB_LATEST_RELEASE_URL, GITHUB_URL } from '@/lib/links'
import { cn } from '@/lib/utils'
import { DEMO_TIMELINE, stillFrame } from './demo/timeline'
import { WebMock } from './demo/WebMock'
import { DeviceFrame, type DeviceShot } from './DeviceFrame'
import { GithubIcon } from './GithubIcon'
import { GithubStars } from './GithubStars'

// Marks from public/ai-icons, or a lucide icon where no mark exists.
// Single-color marks are black, so they are inverted on dark backgrounds.
/** `muted` draws an icon mark in the muted color, for generic tiles that aren't a product. */
type Mark = { name: string; file?: string; icon?: LucideIcon; mono?: boolean; muted?: boolean }

const MODEL_MARKS: Mark[] = [
  { name: 'OpenAI', file: 'openai.svg', mono: true },
  { name: 'Claude', file: 'claude-color.svg' },
  { name: 'Gemini', file: 'gemini-color.svg' },
  { name: 'Grok', file: 'grok.svg', mono: true },
  { name: 'Mistral', file: 'mistral-color.svg' },
  { name: 'DeepSeek', file: 'deepseek-color.svg' },
  { name: 'Qwen', file: 'qwen-color.svg' },
  { name: 'Kimi', file: 'moonshot.svg', mono: true },
  { name: 'GLM', file: 'zhipu-color.svg' },
]

const LOCAL_INFERENCE_MARKS: Mark[] = [
  { name: 'vLLM', file: 'vllm-color.svg' },
  { name: 'llama.cpp', icon: Cpu },
  { name: 'Ollama', file: 'ollama.svg', mono: true },
]

const INFERENCE_HOST_MARKS: Mark[] = [
  { name: 'Azure AI Foundry', file: 'azureai-color.svg' },
  { name: 'Fireworks', file: 'fireworks-color.svg' },
  { name: 'Baseten', file: 'baseten.svg', mono: true },
  { name: 'OpenRouter', file: 'openrouter.svg', mono: true },
]

const SELF_HOST_COMMANDS = [
  'git clone https://github.com/IsaacThoman/pulpo.git',
  'cd pulpo',
  'cp .env.example .env',
  'docker compose up --build -d',
]

function Section({ id, className, children }: { id: string; className?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className={cn('mx-auto max-w-6xl px-4 py-12 sm:px-8 md:py-16', className)}>{children}</div>
    </section>
  )
}

function Heading({ title, lead, centered }: { title: string; lead?: string; centered?: boolean }) {
  return (
    <div className={cn('max-w-2xl', centered && 'mx-auto text-center')}>
      <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
      {lead ? <p className="mt-4 text-base text-pretty text-muted-foreground sm:text-lg">{lead}</p> : null}
    </div>
  )
}

function Points({ items }: { items: Array<{ title: string; body: string }> }) {
  return (
    <dl className="mt-8 space-y-5">
      {items.map((item) => (
        <div key={item.title} className="flex gap-3">
          <Check className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <dt className="font-medium">{item.title}</dt>
            <dd className="mt-1 text-sm text-pretty text-muted-foreground">{item.body}</dd>
          </div>
        </div>
      ))}
    </dl>
  )
}

function TerminalWindow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-2xl shadow-black/10 dark:shadow-black/40">
      <div className="flex items-center gap-3 border-b px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </span>
        <span className="truncate font-mono text-xs text-muted-foreground">{title}</span>
      </div>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[13px] leading-6">{children}</pre>
    </div>
  )
}

function MarkIcon({ mark }: { mark: Mark }) {
  if (mark.icon) return <mark.icon className={cn('size-8', mark.muted ? 'text-muted-foreground' : 'text-foreground')} strokeWidth={1.5} aria-hidden="true" />
  return <img src={`/ai-icons/${mark.file}`} alt="" width={32} height={32} loading="lazy" className={cn('size-8', mark.mono && 'dark:invert')} />
}

function MarkTile({ mark, className }: { mark: Mark; className?: string }) {
  return (
    <li className={cn('flex flex-col items-center justify-center gap-3 bg-background px-2 py-7', className)}>
      <MarkIcon mark={mark} />
      <span className="text-center text-sm font-medium text-balance">{mark.name}</span>
    </li>
  )
}

function MarkRow({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div>
      <h3 id={id} className="mb-3 text-sm font-medium text-muted-foreground">{label}</h3>
      <ul aria-labelledby={id} className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-9">{children}</ul>
    </div>
  )
}

export function ModelsSection() {
  return (
    <Section id="models">
      <Heading centered title={ui("Use any model")} lead={ui("Run open-weight models on your own GPUs, so conversations can stay on your network, or use the hosted APIs you already pay for. You can freely switch between models and providers in the middle of a conversation.")} />
      <div className="mt-12 space-y-8">
        <MarkRow id="models-labs" label={ui("Models")}>
          {MODEL_MARKS.map((mark) => <MarkTile key={mark.name} mark={mark} />)}
        </MarkRow>
        <MarkRow id="models-hosts" label={ui("Runs on")}>
          {/* Opaque tile with the tint inside it, so the grid's border color doesn't show through. */}
          <li className="col-span-3 bg-background lg:col-span-4">
            <div className="flex h-full flex-col justify-center bg-muted/50 px-2 py-5 dark:bg-muted/40">
              <span className="text-center text-xs font-medium text-muted-foreground">{ui("Your own hardware")}</span>
              <ul className="mt-4 grid grid-cols-3">
                {LOCAL_INFERENCE_MARKS.map((mark) => (
                  <li key={mark.name} className="flex flex-col items-center gap-3 px-2">
                    <MarkIcon mark={mark} />
                    <span className="text-center text-sm font-medium">{mark.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          </li>
          {INFERENCE_HOST_MARKS.map((mark) => <MarkTile key={mark.name} mark={mark} />)}
          <MarkTile mark={{ name: ui("Any compatible endpoint"), icon: Plug, muted: true }} className="col-span-2 lg:col-span-1" />
        </MarkRow>
      </div>
    </Section>
  )
}

export function WorkspacesSection() {
  return (
    <Section id="workspaces" className="grid items-center gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-16">
      <div>
        <Heading title={ui("A fresh computer for every task")} lead={ui("Turn on Agent mode and the model gets its own Linux machine. Workspaces are claimed from a warm pool, so they start in an instant.")} />
        <Points items={[
          { title: ui("Isolated"), body: ui("Every session runs in its own lightweight virtual machine, with nothing shared between chats or people.") },
          { title: ui("Ready to work"), body: ui("Python, Node.js, Git, and FFmpeg come preinstalled, along with tools for spreadsheets, PDFs, Word, and PowerPoint.") },
          { title: ui("Disposable"), body: ui("The agent has root, and nothing it does can outlive the session. What you want to keep goes to your Files.") },
        ]} />
      </div>
      <div role="img" aria-label={ui("A Pulpo agent starting a workspace, running Python, and attaching the chart it made")} className="mx-auto w-full max-w-xl">
        <div aria-hidden="true" className="select-none"><WebMock timeline={DEMO_TIMELINE} frame={stillFrame(DEMO_TIMELINE, 'agent', 'done')} panel /></div>
      </div>
    </Section>
  )
}

// Simulator and emulator captures; see "App screenshots" in docs/landing-screenshots.md.
// A function so the alt text is translated at render time rather than at module load.
const appShots = (): DeviceShot[] => [
  { platform: 'ios', alt: ui("Pulpo on iPhone with the model menu open"), light: '/landing/app-ios-models-light.webp', dark: '/landing/app-ios-models-dark.webp', width: 600, height: 1304 },
  { platform: 'android', alt: ui("Pulpo on Android answering a question about brunch spots"), light: '/landing/app-android-brunch-light.webp', dark: '/landing/app-android-brunch-dark.webp', width: 600, height: 1333 },
  { platform: 'ios', alt: ui("Pulpo on iPhone showing the list of chats"), light: '/landing/app-ios-drawer-light.webp', dark: '/landing/app-ios-drawer-dark.webp', width: 600, height: 1304 },
]

export function AppsSection() {
  const platforms = [
    { name: ui("iPhone and iPad"), detail: ui("App Store"), href: APP_STORE_URL },
    { name: ui("Android"), detail: ui("APK on GitHub"), href: GITHUB_LATEST_RELEASE_URL },
    { name: ui("macOS and Windows"), detail: ui("Desktop app"), href: GITHUB_LATEST_RELEASE_URL },
    { name: ui("Command line"), detail: 'npm i -g @isaacthoman/pulpo', href: 'https://www.npmjs.com/package/@isaacthoman/pulpo', mono: true },
  ]
  return (
    <Section id="apps">
      <Heading centered title={ui("Native apps for iPhone and Android")} lead={ui("Built with SwiftUI and Liquid Glass on iOS and Material 3 Expressive on Android.")} />
      {/* On phones the row is wider than the screen: the middle phone stays readable and the outer two run off the edges. */}
      <div role="img" aria-label={ui("The Pulpo apps on iPhone and Android showing the model menu, an answer, and the list of chats")} className="-mx-[24%] mt-12 sm:mx-auto sm:max-w-4xl">
        <div aria-hidden="true" className="grid grid-cols-3 items-end gap-4 select-none sm:gap-10">
          {appShots().map((shot, index) => (
            <div key={shot.light} className={cn(index !== 1 && 'mb-6 sm:mb-10')}><DeviceFrame shot={shot} /></div>
          ))}
        </div>
      </div>
      <ul className="mt-12 grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {platforms.map((platform) => (
          <li key={platform.name} className="bg-background">
            <a href={platform.href} className="group flex h-full items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-accent/60">
              <span className="min-w-0">
                <span className="block font-medium">{platform.name}</span>
                <span className={cn('mt-0.5 block truncate text-sm text-muted-foreground', platform.mono && 'font-mono text-xs leading-5')}>{platform.detail}</span>
              </span>
              <Download className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
    </Section>
  )
}

export function MoreSection() {
  const features = [
    { icon: Files, title: ui("Files and documents"), body: ui("Folders, uploads, and collaborative documents live next to your chats, and agents can work on them.") },
    { icon: Search, title: ui("Memory and search"), body: ui("Pulpo can recall earlier conversations and search them by meaning, not just by keyword.") },
    { icon: AudioLines, title: ui("Voice"), body: ui("Dictate a message, or have any answer read aloud with playback controls.") },
    { icon: ImageIcon, title: ui("Image generation"), body: ui("Agents create images with the image models you connect.") },
    { icon: GraduationCap, title: ui("Quizzes and flashcards"), body: ui("Ask to be quizzed and the reply becomes an interactive quiz with hints and a score.") },
    { icon: Link2, title: ui("Sharing"), body: ui("Publish a conversation as a public link that anyone can read.") },
    { icon: KeyRound, title: ui("Developer API"), body: ui("OpenAI- and Anthropic-compatible endpoints, with keys you issue yourself.") },
    { icon: ShieldCheck, title: ui("Passkeys and two-factor"), body: ui("Sign in with a passkey or protect your account with a second factor.") },
  ]
  return (
    <Section id="more">
      <Heading title={ui("And everything else you'd expect")} />
      <ul className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((feature) => (
          <li key={feature.title}>
            <feature.icon className="size-5 text-muted-foreground" aria-hidden="true" />
            <h3 className="mt-3 font-medium">{feature.title}</h3>
            <p className="mt-1.5 text-sm text-pretty text-muted-foreground">{feature.body}</p>
          </li>
        ))}
      </ul>
    </Section>
  )
}

export function SelfHostSection() {
  return (
    <Section id="self-host" className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
      <div>
        <Heading title={ui("Yours to read, change, and self-host")} lead={ui("The code for the whole stack is public on GitHub: server, web, desktop, mobile, and the workspace infrastructure.")} />
        <Points items={[
          { title: ui("One Docker Compose file"), body: ui("Postgres, Redis, object storage, the API, the worker, and the web app start together.") },
          { title: ui("Run it your way"), body: ui("Manage providers, models, people, and budgets from the admin panel or the pulpo command line.") },
          { title: ui("No telemetry"), body: ui("Pulpo never phones home. There are no analytics, crash reports, or usage data sent back to us, in the server or in the apps.") },
        ]} />
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg"><a href={GITHUB_URL}><GithubIcon />{ui("View on GitHub")}<GithubStars className="ml-0.5 text-primary-foreground/80 before:mr-1.5 before:h-4 before:w-px before:bg-primary-foreground/30" /></a></Button>
          <Button asChild size="lg" variant="outline"><a href={DOCS_URL}>{ui("Read the docs")}</a></Button>
        </div>
        <p className="mt-5 text-sm text-muted-foreground">{ui("Free for personal and noncommercial use under the Pulpo Noncommercial License.")}</p>
      </div>
      <TerminalWindow title={ui("Self-host in four commands")}>
        {SELF_HOST_COMMANDS.map((command) => (
          <span key={command}><span className="text-muted-foreground select-none">{'$ '}</span>{command}{'\n'}</span>
        ))}
        <span className="text-muted-foreground">{'# http://localhost:8080'}</span>
      </TerminalWindow>
    </Section>
  )
}
