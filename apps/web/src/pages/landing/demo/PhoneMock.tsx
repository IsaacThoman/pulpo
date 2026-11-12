import { Archive, ArrowUp, Bot, Brain, ChevronRight, Delete, FlaskConical, Ghost, Hourglass, Menu, Mic, Plus, ShieldCheck, Smile, Square, SquarePen, Wrench } from 'lucide-react'
import { ui } from '@/i18n/ui'
import { cn } from '@/lib/utils'
import { MarkdownLite } from './MarkdownLite'
import { followsNewest, responseParts } from './response'
import { modelById, type DemoFrame, type DemoTimeline } from './timeline'
import { ModelMark, T13, T15 } from './WebMock'

const T16 = 'text-[length:calc(var(--spacing)*4)]'
const T17 = 'text-[length:calc(var(--spacing)*4.25)]'
const LETTER_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
const PREDICTIONS = ['I', 'The', 'I’m']

// iOS surfaces: floating glass controls, and the keyboard's two key colors.
const GLASS = 'bg-white shadow-sm ring-1 ring-black/[0.06] dark:bg-white/[0.09] dark:shadow-none dark:ring-white/[0.09]'
const KEY = 'bg-white shadow-[0_1px_0_rgb(0_0_0/0.28)] dark:bg-white/[0.26] dark:shadow-[0_1px_0_rgb(0_0_0/0.5)]'
const KEY_ALT = 'bg-[#abb1bc] shadow-[0_1px_0_rgb(0_0_0/0.28)] dark:bg-white/[0.12] dark:shadow-[0_1px_0_rgb(0_0_0/0.5)]'
const KEY_RADIUS = 'rounded-[calc(var(--spacing)*1.4)]'

function Touch() {
  return <span className="pointer-events-none absolute inset-0 z-10 m-auto size-8 rounded-full bg-sky-400/45 ring-1 ring-sky-300/60" />
}

function StatusIcons() {
  return (
    <span className="flex items-center gap-1.5">
      <svg viewBox="0 0 18 12" className="h-3 w-4.5" fill="currentColor" aria-hidden="true">
        <rect x="0" y="8" width="3" height="4" rx="0.8" /><rect x="5" y="5.5" width="3" height="6.5" rx="0.8" /><rect x="10" y="3" width="3" height="9" rx="0.8" /><rect x="15" y="0" width="3" height="12" rx="0.8" />
      </svg>
      <svg viewBox="0 0 17 12" className="h-3 w-4.25" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" aria-hidden="true">
        <path d="M1.2 4.3a10.6 10.6 0 0 1 14.6 0" /><path d="M4 7.2a6.6 6.6 0 0 1 9 0" /><circle cx="8.5" cy="10.4" r="1.1" fill="currentColor" stroke="none" />
      </svg>
      <svg viewBox="0 0 27 13" className="h-3.25 w-6.75" aria-hidden="true">
        <rect x="0.5" y="0.5" width="23" height="12" rx="3.8" fill="none" stroke="currentColor" opacity="0.4" />
        <rect x="2" y="2" width="20" height="9" rx="2.5" fill="currentColor" /><path d="M25 4.5v4c.8-.3 1.5-1.1 1.5-2s-.7-1.7-1.5-2z" fill="currentColor" opacity="0.45" />
      </svg>
    </span>
  )
}

function Keyboard({ frame, hidden }: { frame: DemoFrame; hidden: boolean }) {
  // iOS capitalizes the start of a message.
  const upper = !frame.phone.chat && frame.phone.draft.length === 0
  const letter = (key: string) => {
    const pressed = frame.pressedKey === key
    return (
      <span key={key} className={cn('relative flex h-10.5 w-[calc(var(--spacing)*8.4)] items-center justify-center', KEY_RADIUS, KEY, upper ? 'text-[length:calc(var(--spacing)*5.5)]' : 'pb-0.5 text-[length:calc(var(--spacing)*6)]')}>
        {upper ? key.toUpperCase() : key}
        {pressed ? (
          <>
            <span className={cn('absolute bottom-[105%] left-1/2 z-10 flex h-[130%] w-[150%] -translate-x-1/2 items-center justify-center pb-0.5 text-[length:calc(var(--spacing)*8)] shadow-lg', KEY_RADIUS, 'bg-white dark:bg-[#6c6c70]')}>{key}</span>
            <Touch />
          </>
        ) : null}
      </span>
    )
  }
  return (
    <div className={cn('absolute inset-x-0 bottom-0 h-84 rounded-t-[calc(var(--spacing)*7)] bg-[#d2d5db] px-1.5 transition-transform duration-300 dark:bg-[#2b2b2d]', hidden && 'translate-y-full')}>
      <div className={cn('flex h-11 items-center text-black/60 dark:text-white/60', T16)}>
        {PREDICTIONS.map((word, index) => (
          <span key={word} className={cn('flex-1 text-center', index > 0 && 'border-l border-black/10 dark:border-white/15')}>{word}</span>
        ))}
      </div>
      <div className="flex justify-center gap-1.5">{[...LETTER_ROWS[0]!].map(letter)}</div>
      <div className="mt-2.75 flex justify-center gap-1.5">{[...LETTER_ROWS[1]!].map(letter)}</div>
      <div className="mt-2.75 flex justify-between">
        <span className={cn('flex h-10.5 w-10.75 items-center justify-center', KEY_RADIUS, upper ? KEY : KEY_ALT)}>
          <svg viewBox="0 0 20 18" className="h-4.5 w-5" fill={upper ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d="M10 1.5 1.8 9.6h4.1V16h8.2V9.6h4.1z" /></svg>
        </span>
        <span className="flex gap-1.5">{[...LETTER_ROWS[2]!].map(letter)}</span>
        <span className={cn('flex h-10.5 w-10.75 items-center justify-center', KEY_RADIUS, KEY_ALT)}><Delete className="size-5.5" strokeWidth={1.6} /></span>
      </div>
      <div className={cn('mt-2.75 flex gap-1.5', T16)}>
        <span className={cn('flex h-10.5 w-22.5 items-center justify-center', KEY_RADIUS, KEY_ALT)}>{123}</span>
        <span className={cn('relative flex h-10.5 flex-1 items-center justify-center', KEY_RADIUS, frame.pressedKey === ' ' ? 'bg-[#abb1bc] dark:bg-white/[0.14]' : KEY)}>
          {ui("space")}{frame.pressedKey === ' ' ? <Touch /> : null}
        </span>
        <span className={cn('flex h-10.5 w-22.5 items-center justify-center', KEY_RADIUS, KEY_ALT)}>{ui("return")}</span>
      </div>
      <div className="mt-4 flex items-center justify-between px-6 text-black/75 dark:text-white/80">
        <Smile className="size-6.5" strokeWidth={1.7} /><Mic className="size-6" strokeWidth={1.7} />
      </div>
    </div>
  )
}

/**
 * An iPhone running the Pulpo app: the composer and keyboard, the model menu, then the chat.
 * `keyboard={false}` shows a new chat at rest, before the composer is tapped.
 */
export function PhoneMock({ timeline, frame, keyboard = true }: { timeline: DemoTimeline; frame: DemoFrame; keyboard?: boolean }) {
  const { script } = timeline
  const { phone } = frame
  const compiled = timeline.scenes[frame.scene]!
  const model = modelById(script, phone.modelId)
  const controls = model.controls ?? script.models[0]!.controls
  const { traced, pending, thinking, workLabel, attachment } = responseParts(compiled, phone)
  const answering = compiled.endModel
  const picker = frame.picker?.on === 'phone' ? frame.picker : null
  const typing = keyboard && !phone.chat
  const button = 'bg-neutral-500 dark:bg-neutral-600'
  return (
    <div className="landing-device">
      <div className="landing-device-canvas relative aspect-[430/902] [--dw:430]">
        {/* Action, volume, and side buttons. */}
        <span className={cn('absolute top-[17.5%] -left-[0.7%] h-[3.6%] w-[1.4%] rounded-l-sm', button)} />
        <span className={cn('absolute top-[24.5%] -left-[0.7%] h-[6.6%] w-[1.4%] rounded-l-sm', button)} />
        <span className={cn('absolute top-[32.5%] -left-[0.7%] h-[6.6%] w-[1.4%] rounded-l-sm', button)} />
        <span className={cn('absolute top-[28%] -right-[0.7%] h-[10.5%] w-[1.4%] rounded-r-sm', button)} />
        <div className="absolute inset-0 rounded-[calc(var(--spacing)*17.5)] bg-linear-to-b from-neutral-400 via-neutral-600 to-neutral-500 p-1 shadow-2xl shadow-black/30 dark:from-neutral-500 dark:via-neutral-700 dark:to-neutral-600 dark:shadow-black/70">
          <div className="size-full rounded-[calc(var(--spacing)*16.5)] bg-black p-2.5">
            <div className="relative size-full overflow-hidden rounded-[calc(var(--spacing)*14)] bg-white text-black dark:bg-black dark:text-white">
              <div className={cn('absolute inset-x-0 top-0 z-30 flex h-13.5 items-center justify-between pt-2.5 pr-8.5 pl-12.5 font-semibold', T17)}>
                {'9:41'}<StatusIcons />
              </div>
              <span className="absolute top-2.75 left-1/2 z-30 h-9.25 w-31.5 -translate-x-1/2 rounded-full bg-black" />

              <div className="absolute inset-0" style={{ opacity: frame.opacity }}>
                {/* The chat scrolls under the floating header, which fades it out at the top. */}
                <div className="absolute inset-x-0 top-0 z-10 h-33 bg-linear-to-b from-white from-[84%] to-transparent dark:from-black" />
                <div className="absolute inset-x-4 top-15.5 z-20 flex h-11 items-center justify-between">
                  <span className={cn('flex size-11 items-center justify-center rounded-full', GLASS)}><Menu className="size-5" /></span>
                  <span className={cn('relative flex h-11 items-center gap-2 rounded-full px-4 font-medium', GLASS, T17)}>
                    <ModelMark icon={model.icon} className="size-5.5" />{model.name}
                    {frame.touch === 'model' ? <Touch /> : null}
                  </span>
                  <span className={cn('flex h-11 items-center gap-4 rounded-full px-3.5', GLASS)}>
                    <Hourglass className="size-4.5" />{phone.chat ? <SquarePen className="size-4.5" /> : <Ghost className="size-4.5" />}
                  </span>
                </div>

                {picker ? (
                  <div className={cn('absolute top-29 left-1/2 z-20 w-[70%] -translate-x-1/2 rounded-[calc(var(--spacing)*7)] bg-white/85 p-2 shadow-2xl ring-1 shadow-black/20 ring-black/[0.06] backdrop-blur-xl dark:bg-[#2a2a2c]/85 dark:ring-white/10', T17)}>
                    <div className={cn('px-4 pt-1.5 pb-1 text-black/45 dark:text-white/50', T13)}>{ui("Favorites")}</div>
                    {script.models.map((candidate) => (
                      <div key={candidate.id} className={cn('relative flex h-12 items-center gap-3 rounded-[calc(var(--spacing)*5)] px-4', picker.pressed === candidate.id && 'bg-black/[0.07] dark:bg-white/[0.12]')}>
                        <ModelMark icon={candidate.icon} className="size-7" />{candidate.name}
                        {picker.pressed === candidate.id && frame.touch === 'pick' ? <Touch /> : null}
                      </div>
                    ))}
                    <div className="mx-4 my-1.5 border-t border-black/10 dark:border-white/10" />
                    <div className="flex h-12 items-center gap-3 px-4"><FlaskConical className="size-6" strokeWidth={1.7} />{ui("Labs")}<ChevronRight className="ml-auto size-4.5 opacity-60" /></div>
                  </div>
                ) : null}

                {phone.chat ? (
                  // Reversed so that once the conversation outgrows the screen, its newest part stays in view.
                  <div className={cn('absolute inset-x-4 top-0 bottom-36 flex overflow-hidden', followsNewest(compiled, phone) ? 'flex-col-reverse' : 'flex-col', T16)}>
                    <div className="mb-auto pt-33 pb-2">
                      <div className="ml-auto w-fit max-w-[80%] rounded-[calc(var(--spacing)*5)] bg-[#efeff2] px-4 py-2 dark:bg-[#1f1f21]">{compiled.prompt}</div>
                      <div className="mt-6 flex items-center gap-2">
                        <ModelMark icon={answering.icon} className="size-6" />
                        <span className={cn('font-semibold', T15)}>{answering.name}</span>
                        <span className="text-xs text-black/45 dark:text-white/50">{ui("just now")}</span>
                      </div>
                      {traced ? (
                        <div className={cn('mt-1.5 flex items-center gap-1.5 text-black/50 dark:text-white/55', T15, phone.working && 'animate-pulse')}>{thinking ? <Brain className="size-4" /> : <Wrench className="size-4" />}{workLabel}<ChevronRight className="size-3.5" /></div>
                      ) : pending ? (
                        // The app's ResponsePendingIndicator: three 6pt dots in its muted color, rising in turn.
                        <div className="mt-1 flex min-h-7 items-center gap-1 py-1">
                          {[0, 150, 300].map((delay) => (
                            <span key={delay} className="landing-phone-pending-dot size-1.5 rounded-full bg-[#68686f] dark:bg-[#a1a1a8]" style={{ animationDelay: `${delay}ms` }} />
                          ))}
                        </div>
                      ) : null}
                      {phone.answer ? (
                        <div className="mt-1.5 space-y-2 leading-[1.4]">
                          <MarkdownLite text={phone.answer} cursor={phone.streaming} listClassName="list-disc space-y-1.5 pl-5.5" />
                        </div>
                      ) : null}
                      {attachment ? (
                        <div className="mt-3 w-[78%] overflow-hidden rounded-[calc(var(--spacing)*4.5)] bg-[#efeff2] ring-1 ring-black/[0.06] dark:bg-[#1c1c1e] dark:ring-white/[0.08]">
                          <img src={attachment.src} alt="" width={attachment.width} height={attachment.height} loading="lazy" className="block h-auto w-full bg-white" />
                          <div className="px-3 py-2 leading-tight">
                            <span className={cn('block truncate font-medium', T15)}>{attachment.name}</span>
                            <span className="block text-xs text-black/45 dark:text-white/50">{attachment.meta}</span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="absolute inset-x-0 top-[27%] flex flex-col items-center">
                    <div className="flex items-center gap-2.5">
                      <ModelMark icon={model.icon} className="size-10" />
                      <span className="text-[length:calc(var(--spacing)*6.5)] font-semibold tracking-tight">{model.name}</span>
                    </div>
                    <div className={cn('mt-1 flex items-center gap-1.5 text-black/50 dark:text-white/55', T13)}>{model.lab}<ShieldCheck className="size-3.5 text-green-500" /></div>
                  </div>
                )}

                <div className={cn('absolute inset-x-3 z-10 rounded-[calc(var(--spacing)*6.5)] bg-white p-3 pb-2.5 shadow-lg ring-1 shadow-black/10 ring-black/[0.07] transition-[bottom] duration-300 dark:bg-[#1c1c1e] dark:shadow-none dark:ring-white/[0.08]', typing ? 'bottom-86' : 'bottom-7')}>
                  <div className={cn('relative flex min-h-11 items-start justify-between gap-2 px-1', T17)}>
                    <p className={cn('min-w-0 leading-snug', !phone.draft && 'text-black/40 dark:text-white/40')}>
                      {phone.draft || ui("Message…")}
                      {frame.phoneCaret && typing ? <span className="mx-px inline-block h-[1.2em] w-[calc(var(--spacing)*0.5)] translate-y-[0.22em] rounded-full bg-[#3478f6]" /> : null}
                    </p>
                    <Archive className="mt-1 size-4.5 shrink-0 text-black/30 dark:text-white/35" />
                    {frame.touch === 'composer' ? <Touch /> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={cn('flex size-9 items-center justify-center rounded-full', GLASS)}><Plus className="size-5" /></span>
                    <span className={cn('flex h-9 items-center rounded-full px-3.5', GLASS, T15)}>{[controls?.reasoning, controls?.speed].filter(Boolean).join(' · ')}</span>
                    <span className="flex size-9 items-center justify-center rounded-full bg-[#af52de] text-white dark:bg-[#bf5af2]"><Bot className="size-4.5" /></span>
                    <span className={cn('ml-auto flex size-9 items-center justify-center rounded-full', GLASS)}><Mic className="size-4.5" /></span>
                    <span className={cn('relative flex size-9 items-center justify-center rounded-full', phone.draft || (phone.chat && phone.streaming) ? 'bg-black text-white dark:bg-white dark:text-black' : 'bg-black/25 text-white dark:bg-white/30 dark:text-black')}>
                      {phone.chat && phone.streaming ? <Square className="size-3.5 fill-current" /> : <ArrowUp className="size-5" />}
                      {frame.touch === 'send' ? <Touch /> : null}
                    </span>
                  </div>
                </div>

                <Keyboard frame={frame} hidden={!typing} />
              </div>
              <span className="absolute bottom-2 left-1/2 z-30 h-1.25 w-36 -translate-x-1/2 rounded-full bg-black/85 dark:bg-white/85" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
