import { useMemo, useState } from 'react'
import {
  Database,
  LayoutGrid,
  Lock,
  FileSearch,
  ScrollText,
  SlidersHorizontal,
  Bot,
  Sparkles,
  Ticket,
  Mic,
  BrainCircuit,
} from 'lucide-react'
import { AuthenticationSection, GeneralSection, InterfaceSection } from './sections-general'
import { DatabaseSection } from './sections-data'
import { OcrSection } from './sections-ocr'
import { LoggingSection } from './sections-logging'
import { AgentSection } from './sections-agent'
import { PersonalizationSection } from './sections-personalization'
import { InviteCodesSection } from './sections-invites'
import { DictationSection } from './sections-dictation'
import { EpisodicMemorySection } from './sections-episodic-memory'
import { cn } from '@/lib/utils'
import { useAuth } from '@/stores/auth'
import { ui } from '@/i18n/ui'

const SECTIONS = [
  { id: 'general', label: "General", icon: SlidersHorizontal, component: GeneralSection },
  { id: 'auth', label: "Authentication", icon: Lock, component: AuthenticationSection },
  { id: 'interface', label: "Interface", icon: LayoutGrid, component: InterfaceSection },
  { id: 'personalization', label: "Personalization", icon: Sparkles, component: PersonalizationSection },
  { id: 'ocr', label: "OCR", icon: FileSearch, component: OcrSection },
  { id: 'dictation', label: "Dictation", icon: Mic, component: DictationSection },
  { id: 'agent', label: "Agent", icon: Bot, component: AgentSection },
  { id: 'episodic-memory', label: "Episodic Memory", icon: BrainCircuit, component: EpisodicMemorySection },
  { id: 'logging', label: "Logging", icon: ScrollText, component: LoggingSection },
  { id: 'database', label: "Database", icon: Database, component: DatabaseSection },
] as const

type SectionId = (typeof SECTIONS)[number]['id'] | 'invites'

export function AdminSettingsPage() {
  const billingEnabled = useAuth((state) => state.billingEnabled)
  const sections = useMemo(() => billingEnabled
    ? [...SECTIONS, { id: 'invites' as const, label: "Invite Codes", icon: Ticket, component: InviteCodesSection }]
    : [...SECTIONS], [billingEnabled])
  const [active, setActive] = useState<SectionId>('general')
  const current = sections.find((s) => s.id === active) ?? sections[0]!
  const CurrentSection = current.component

  return (
    <div className="flex gap-6">
      <nav className="w-44 shrink-0 space-y-0.5">
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            className={cn(
              'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition-colors',
              active === s.id
                ? 'bg-accent font-medium'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
          >
            <s.icon className="size-4" />
            {ui(s.label)}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1"><CurrentSection /></div>
    </div>
  )
}
