import { Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ui } from '@/i18n/ui'
import { PhoneMock } from './PhoneMock'
import { useDemoFrame } from './useDemoFrame'
import { WebMock } from './WebMock'

/** The browser and phone show the same recorded conversation (see docs/landing-screenshots.md). */
export function HeroDemo() {
  const { timeline, frame, playing, select, togglePlayback } = useDemoFrame()
  const activeScene = timeline.scenes[frame.scene]!.scene.id
  const labels: Record<string, string> = { sync: ui("Chat sync"), models: ui("Any model"), agent: ui("Agent workspaces") }
  const playbackLabel = playing ? ui("Pause demo") : ui("Play demo")
  return (
    <Tabs id="landing-demo" value={activeScene} onValueChange={select} className="gap-4">
      <div className="flex items-center justify-between gap-2 border-b">
        <TabsList aria-label={ui("Demo scenes")} className="h-auto min-w-0 flex-wrap justify-start gap-x-1 bg-transparent p-0 sm:gap-x-4">
          {timeline.scenes.map(({ scene }) => (
            <TabsTrigger key={scene.id} value={scene.id} className="relative h-auto min-h-10 flex-none rounded-none border-0 bg-transparent px-1 py-2 text-xs font-medium whitespace-normal text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 data-[state=active]:after:bg-[#a18b14] dark:data-[state=active]:bg-transparent dark:data-[state=active]:after:bg-[#d8c443] sm:px-2 sm:text-sm sm:after:inset-x-2">
              {labels[scene.id] ?? scene.id}
            </TabsTrigger>
          ))}
        </TabsList>
        <Button type="button" variant="ghost" size="sm" onClick={togglePlayback} aria-label={playbackLabel} title={playbackLabel} data-demo-playback={playing ? 'playing' : 'idle'} className="h-10 rounded-lg">
          {playing ? <Pause strokeWidth={1.5} /> : <Play strokeWidth={1.5} />}
          <span className="hidden sm:inline">{playbackLabel}</span>
        </Button>
      </div>
      {timeline.scenes.map(({ scene }) => (
        <TabsContent key={scene.id} value={scene.id} className="rounded-xl focus-visible:outline-2 focus-visible:outline-ring">
          {scene.id === activeScene ? (
            <div role="img" aria-label={ui("An animated demo of Pulpo on the web and on an iPhone, signed in to one account. A message started in the browser is finished and sent from the phone, a model chosen on the phone changes in the browser, and an agent runs code in a workspace and attaches a chart. Every answer appears on both screens.")} className="relative sm:pb-[10%]">
              <div aria-hidden="true" className="select-none">
                <div className="sm:ms-auto sm:w-[93%]"><WebMock timeline={timeline} frame={frame} /></div>
                {/* The phone covers the sidebar and leaves the conversation visible. */}
                <div className="mx-auto mt-6 w-[72%] max-w-72 sm:absolute sm:bottom-0 sm:start-[4%] sm:mt-0 sm:w-[24%] sm:max-w-none"><PhoneMock timeline={timeline} frame={frame} /></div>
              </div>
            </div>
          ) : null}
        </TabsContent>
      ))}
    </Tabs>
  )
}
