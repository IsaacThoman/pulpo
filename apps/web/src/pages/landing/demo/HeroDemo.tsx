import { useRef } from 'react'
import { Layers, RefreshCw, Terminal } from 'lucide-react'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { PhoneMock } from './PhoneMock'
import { useDemoFrame } from './useDemoFrame'
import { WebMock } from './WebMock'

const SCENE_ICONS: Record<string, typeof Layers> = { sync: RefreshCw, models: Layers, agent: Terminal }

/**
 * The hero: one account on two screens, playing the scenes in demo/script.json in turn. The tabs name what
 * each scene shows and jump to it. Everything on the screens is a real answer with its real timing (see
 * docs/landing-screenshots.md).
 */
export function HeroDemo() {
  const root = useRef<HTMLDivElement>(null)
  const { timeline, frame, seek } = useDemoFrame(root)
  const labels: Record<string, string> = { sync: ui("Perfect sync"), models: ui("Any model"), agent: ui("Instant workspaces") }
  return (
    <div ref={root} className="mx-auto max-w-6xl">
      <div role="tablist" aria-label={ui("Demo scenes")} className="flex flex-wrap justify-center gap-x-2 gap-y-1">
        {timeline.scenes.map(({ scene }, index) => {
          const active = index === frame.scene
          const Icon = SCENE_ICONS[scene.id] ?? Layers
          return (
            <button key={scene.id} type="button" role="tab" aria-selected={active} onClick={() => seek(index)} className={cn('relative flex cursor-pointer items-center gap-1.5 rounded-md px-3 pt-1.5 pb-2.5 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring', active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              <Icon className="size-4" aria-hidden="true" />{labels[scene.id] ?? scene.id}
              <span className="absolute inset-x-3 bottom-1 h-0.5 overflow-hidden rounded-full bg-border" aria-hidden="true">
                <span className="block h-full rounded-full bg-foreground" style={{ width: active ? `${frame.progress * 100}%` : 0 }} />
              </span>
            </button>
          )
        })}
      </div>
      <div role="img" aria-label={ui("An animated demo of Pulpo on the web and on an iPhone, signed in to one account. A message started in the browser is finished and sent from the phone, a model chosen on the phone changes in the browser, and an agent runs code in a workspace and attaches a chart. Every answer appears on both screens.")} className="relative isolate mt-8 sm:pb-[10%]">
        {/* A faint glow in the logo's yellow, so the windows read as lit from behind. */}
        <div aria-hidden="true" className="pointer-events-none absolute top-[4%] left-1/2 -z-10 h-[72%] w-[86%] -translate-x-1/2 rounded-[50%] bg-[oklch(0.86_0.17_98)] opacity-[0.16] blur-[90px] dark:opacity-[0.09]" />
        <div aria-hidden="true" className="select-none">
          <div className="sm:ml-auto sm:w-[93%]"><WebMock timeline={timeline} frame={frame} /></div>
          {/* In front of the browser, where it covers the sidebar and none of the conversation. */}
          <div className="mx-auto mt-6 w-[56%] max-w-64 sm:absolute sm:bottom-0 sm:left-[4.6%] sm:mt-0 sm:w-[24%] sm:max-w-none"><PhoneMock timeline={timeline} frame={frame} /></div>
        </div>
      </div>
    </div>
  )
}
