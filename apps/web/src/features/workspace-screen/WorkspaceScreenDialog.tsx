import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from 'react'
import { WORKSPACE_SCREEN_CONTROL_RENEW_MS, WORKSPACE_SCREEN_HEIGHT, WORKSPACE_SCREEN_WIDTH } from '@pulpo/contracts'
import { Hand, Loader2, MonitorOff, MousePointer2, SendHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ui } from '@/i18n/ui'
import { detectPlatform } from '@/lib/downloads'
import { cn } from '@/lib/utils'
import { fetchScreenFrame, fetchScreenStatus, lostControl, releaseScreenControlOnExit, sendScreenInput, setScreenControl } from './api'
import { runFrameLoop } from './frame-loop'
import {
  HOVER_MOVE_INTERVAL_MS,
  InputSender,
  TAP_SLOP_PX,
  TOUCH_NOTCH_PX,
  isPasteShortcut,
  keyInput,
  notchSize,
  pasteEvents,
  pictureBox,
  pointerButton,
  screenPoint,
  wheelNotches,
  type ScreenInputEvent,
} from './input'

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; width: number; height: number }
  | { kind: 'none' }
  | { kind: 'unavailable' }
  | { kind: 'error' }

type Control = 'watching' | 'taking' | 'controlling'

/** Phones and tablets, and windows too narrow for a keyboard to be assumed: these get a text field and a row of keys. */
const TOUCH_QUERY = '(pointer: coarse), (width < 640px)'

function subscribeTouch(listener: () => void) {
  const query = window.matchMedia?.(TOUCH_QUERY)
  query?.addEventListener('change', listener)
  return () => query?.removeEventListener('change', listener)
}
function touchSnapshot() {
  return window.matchMedia?.(TOUCH_QUERY).matches ?? false
}

function subscribeVisibility(listener: () => void) {
  document.addEventListener('visibilitychange', listener)
  return () => document.removeEventListener('visibilitychange', listener)
}
function visibleSnapshot() {
  return document.visibilityState !== 'hidden'
}

/** A Mac or an iPad keyboard, where Command does what Ctrl does on Linux. */
function usesCommandKey(): boolean {
  const platform = detectPlatform()
  return platform === 'macos-arm64' || platform === 'ios'
}

/**
 * Watches a chat's workspace screen live and lets the chat's owner take it over. While in control,
 * the picture takes the pointer and the keyboard and sends what the user does to the workspace;
 * nothing typed is kept here beyond the request that carries it.
 */
export function WorkspaceScreenDialog({ chatId, open, onOpenChange }: {
  chatId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [control, setControl] = useState<Control>('watching')
  const touch = useSyncExternalStore(subscribeTouch, touchSnapshot, () => false)
  const controlling = control === 'controlling'
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex flex-col justify-start gap-3 p-4 sm:max-w-none',
          touch
            ? 'sm:w-[min(calc(100vw_-_2rem),calc((100dvh_-_14rem)_*_1.6_+_2rem))]'
            : 'sm:w-[min(calc(100vw_-_2rem),calc((100dvh_-_7rem)_*_1.6_+_2rem))]',
          'max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-h-none max-sm:w-screen max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0',
        )}
        // While in control, Escape is the workspace's and a stray click outside must not close the
        // screen mid-sign-in; the close button still works and hands control back.
        onEscapeKeyDown={(event) => { if (controlling) event.preventDefault() }}
        onInteractOutside={(event) => { if (controlling) event.preventDefault() }}
      >
        {open && <ScreenViewer chatId={chatId} touch={touch} control={control} setControl={setControl} />}
      </DialogContent>
    </Dialog>
  )
}

function ScreenViewer({ chatId, touch, control, setControl }: {
  chatId: string
  touch: boolean
  control: Control
  setControl: (control: Control) => void
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [picture, setPicture] = useState<string | null>(null)
  const [reconnecting, setReconnecting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const visible = useSyncExternalStore(subscribeVisibility, visibleSnapshot, () => true)
  const controlling = control === 'controlling'
  const controllingRef = useRef(false)
  controllingRef.current = controlling
  const regionRef = useRef<HTMLDivElement>(null)
  const lastFrameRef = useRef<string | undefined>(undefined)
  const senderRef = useRef<InputSender | null>(null)

  useEffect(() => {
    const abort = new AbortController()
    setPhase({ kind: 'loading' })
    fetchScreenStatus(chatId, abort.signal).then((status) => {
      if (abort.signal.aborted) return
      setPhase(status.state === 'ready' ? { kind: 'ready', width: status.width, height: status.height } : { kind: status.state })
    }, () => { if (!abort.signal.aborted) setPhase({ kind: 'error' }) })
    return () => abort.abort()
  }, [chatId, attempt])

  // Each new picture replaces the last, and the old object URL is let go with it.
  const pictureRef = useRef<string | null>(null)
  const showFrame = useCallback((image: Blob) => {
    const url = URL.createObjectURL(image)
    if (pictureRef.current) URL.revokeObjectURL(pictureRef.current)
    pictureRef.current = url
    setPicture(url)
  }, [])
  useEffect(() => () => {
    if (pictureRef.current) URL.revokeObjectURL(pictureRef.current)
    pictureRef.current = null
  }, [])

  const ready = phase.kind === 'ready'
  useEffect(() => {
    if (!ready || !visible) return
    const abort = new AbortController()
    void runFrameLoop({
      fetchFrame: (after, waitMs, signal) => fetchScreenFrame(chatId, after, waitMs, signal),
      onFrame: (image, id) => { lastFrameRef.current = id ?? undefined; showFrame(image) },
      onGone: () => setPhase({ kind: 'none' }),
      onError: (_error, failures) => { if (failures >= 2) setReconnecting(true) },
      onRecovered: () => setReconnecting(false),
    }, abort.signal, lastFrameRef.current)
    return () => abort.abort()
  }, [chatId, ready, visible, showFrame])

  const loseControl = useCallback(() => {
    senderRef.current?.stop()
    senderRef.current = null
    setControl('watching')
    setNotice(ui("Control ended, so you're watching again."))
  }, [setControl])

  const takeControl = async () => {
    setControl('taking')
    setNotice(null)
    try {
      if (!await setScreenControl(chatId, true)) throw new Error('Control was not given')
      senderRef.current = new InputSender(
        (events) => sendScreenInput(chatId, events),
        (error) => { if (lostControl(error)) loseControl(); else setNotice(ui("Some of what you did didn't reach the screen.")) },
      )
      setControl('controlling')
      requestAnimationFrame(() => regionRef.current?.focus())
    } catch (error) {
      setControl('watching')
      if (lostControl(error)) setPhase({ kind: 'none' })
      else setNotice(ui("Couldn't take control. Try again."))
    }
  }

  const handBack = useCallback(() => {
    senderRef.current?.stop()
    senderRef.current = null
    setControl('watching')
    setNotice(null)
    void setScreenControl(chatId, false).catch(() => undefined)
  }, [chatId, setControl])

  // Control is held only while it is renewed, so a viewer that goes away loses it by itself.
  useEffect(() => {
    if (!controlling) return
    const timer = window.setInterval(() => {
      setScreenControl(chatId, true).then((held) => { if (!held) loseControl() }, (error) => { if (lostControl(error)) loseControl() })
    }, WORKSPACE_SCREEN_CONTROL_RENEW_MS)
    return () => window.clearInterval(timer)
  }, [chatId, controlling, loseControl])

  // Closing the dialog, or leaving the page, hands control back.
  useEffect(() => {
    const onExit = () => { if (controllingRef.current) releaseScreenControlOnExit(chatId) }
    window.addEventListener('pagehide', onExit)
    return () => {
      window.removeEventListener('pagehide', onExit)
      if (controllingRef.current) {
        senderRef.current?.stop()
        senderRef.current = null
        void setScreenControl(chatId, false).catch(() => undefined)
        setControl('watching')
      }
    }
  }, [chatId, setControl])

  useEffect(() => {
    if (phase.kind !== 'ready' && controllingRef.current) {
      senderRef.current?.stop()
      senderRef.current = null
      setControl('watching')
    }
  }, [phase.kind, setControl])

  const send = useCallback((event: ScreenInputEvent) => senderRef.current?.push(event), [])
  const sendText = (text: string) => { for (const event of pasteEvents(text)) send(event) }

  const width = phase.kind === 'ready' ? phase.width : WORKSPACE_SCREEN_WIDTH
  const height = phase.kind === 'ready' ? phase.height : WORKSPACE_SCREEN_HEIGHT

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 pr-8 max-sm:pr-0">
        <DialogTitle className="text-base">{ui("Workspace screen")}</DialogTitle>
        <DialogDescription className="sr-only">
          {ui("The workspace's screen, live. Take control to click and type in it yourself; the agent waits until you hand back.")}
        </DialogDescription>
        {ready && (
          <div className="ml-auto flex min-w-0 items-center gap-3 max-sm:ml-0 max-sm:w-full max-sm:justify-between">
            <p role="status" className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', controlling ? 'bg-primary' : 'bg-muted-foreground/60')} />
              <span className={cn(controlling && 'font-medium text-foreground')}>{controlling ? ui("You're in control") : ui("Watching")}</span>
              {notice && <span className="min-w-0 truncate" title={notice}>· {notice}</span>}
            </p>
            {controlling ? (
              <Button size="sm" variant="outline" onClick={handBack}>
                <MousePointer2 /> {ui("Hand back")}
              </Button>
            ) : (
              <Button size="sm" disabled={control === 'taking'} onClick={() => void takeControl()}>
                {control === 'taking' ? <Loader2 className="animate-spin" /> : <Hand />} {ui("Take control")}
              </Button>
            )}
          </div>
        )}
      </div>
      <ScreenArea
        phase={phase}
        width={width}
        height={height}
        picture={picture}
        reconnecting={reconnecting}
        controlling={controlling}
        regionRef={regionRef}
        send={send}
        onRetry={() => setAttempt((value) => value + 1)}
        onPaste={sendText}
      />
      {ready && controlling && touch && <TouchKeys send={send} sendText={sendText} />}
    </>
  )
}

function ScreenArea({ phase, width, height, picture, reconnecting, controlling, regionRef, send, onRetry, onPaste }: {
  phase: Phase
  width: number
  height: number
  picture: string | null
  reconnecting: boolean
  controlling: boolean
  regionRef: React.RefObject<HTMLDivElement | null>
  send: (event: ScreenInputEvent) => void
  onRetry: () => void
  onPaste: (text: string) => void
}) {
  const screen = { width, height }
  const mac = usesCommandKey()
  const buttonsRef = useRef(new Set<string>())
  const hoverRef = useRef<{ at: number; timer: number | null; point: { x: number; y: number } | null }>({ at: 0, timer: null, point: null })
  const wheelRef = useRef({ x: 0, y: 0 })
  const touchRef = useRef<{ id: number; startX: number; startY: number; lastY: number; lastX: number; scrolling: boolean; carryX: number; carryY: number } | null>(null)

  const pointAt = (clientX: number, clientY: number) => {
    const region = regionRef.current
    if (!region) return null
    return screenPoint(clientX, clientY, pictureBox(region.getBoundingClientRect(), screen), screen)
  }

  // Moves while no button is down are sent a few times a second, and the last one always goes.
  const hover = (point: { x: number; y: number }) => {
    const state = hoverRef.current
    state.point = point
    const wait = state.at + HOVER_MOVE_INTERVAL_MS - Date.now()
    if (wait <= 0) {
      state.at = Date.now()
      send({ type: 'move', ...point })
      return
    }
    if (state.timer !== null) return
    state.timer = window.setTimeout(() => {
      state.timer = null
      state.at = Date.now()
      if (state.point) send({ type: 'move', ...state.point })
    }, wait)
  }
  useEffect(() => () => { const timer = hoverRef.current.timer; if (timer !== null) window.clearTimeout(timer) }, [])
  useEffect(() => {
    if (controlling) return
    buttonsRef.current.clear()
    touchRef.current = null
  }, [controlling])

  // React's wheel listener is passive, so the page would scroll too; this one can keep it still.
  useEffect(() => {
    const region = regionRef.current
    if (!region || !controlling) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const point = pointAt(event.clientX, event.clientY)
      if (!point) return
      const unit = notchSize(event.deltaMode)
      const y = wheelNotches(wheelRef.current.y, event.deltaY, unit)
      const x = wheelNotches(wheelRef.current.x, event.deltaX, unit)
      wheelRef.current = { x: x.carry, y: y.carry }
      if (x.notches !== 0 || y.notches !== 0) send({ type: 'scroll', ...point, dx: x.notches, dy: y.notches })
    }
    region.addEventListener('wheel', onWheel, { passive: false })
    return () => region.removeEventListener('wheel', onWheel)
  })

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!controlling) return
    event.preventDefault()
    regionRef.current?.focus()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    if (event.pointerType === 'touch') {
      if (!touchRef.current) touchRef.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, scrolling: false, carryX: 0, carryY: 0 }
      return
    }
    const button = pointerButton(event.button)
    const point = pointAt(event.clientX, event.clientY)
    if (!button || !point) return
    buttonsRef.current.add(button)
    send({ type: 'down', ...point, button })
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!controlling) return
    const touchState = touchRef.current
    if (event.pointerType === 'touch') {
      if (!touchState || touchState.id !== event.pointerId) return
      if (!touchState.scrolling && Math.hypot(event.clientX - touchState.startX, event.clientY - touchState.startY) < TAP_SLOP_PX) return
      touchState.scrolling = true
      // A finger dragged up moves the page down, as it would on the phone itself.
      const y = wheelNotches(touchState.carryY, touchState.lastY - event.clientY, TOUCH_NOTCH_PX)
      const x = wheelNotches(touchState.carryX, touchState.lastX - event.clientX, TOUCH_NOTCH_PX)
      touchState.carryY = y.carry
      touchState.carryX = x.carry
      touchState.lastX = event.clientX
      touchState.lastY = event.clientY
      const point = pointAt(touchState.startX, touchState.startY)
      if (point && (x.notches !== 0 || y.notches !== 0)) send({ type: 'scroll', ...point, dx: x.notches, dy: y.notches })
      return
    }
    const point = pointAt(event.clientX, event.clientY)
    if (!point) return
    if (buttonsRef.current.size > 0) send({ type: 'move', ...point })
    else hover(point)
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!controlling) return
    if (event.pointerType === 'touch') {
      const touchState = touchRef.current
      if (!touchState || touchState.id !== event.pointerId) return
      touchRef.current = null
      const point = pointAt(touchState.startX, touchState.startY)
      if (!touchState.scrolling && point) send({ type: 'click', ...point, button: 'left', count: 1 })
      return
    }
    const button = pointerButton(event.button)
    if (!button || !buttonsRef.current.delete(button)) return
    const point = pointAt(event.clientX, event.clientY)
    if (point) send({ type: 'up', ...point, button })
  }

  // A lost pointer still lets go of every button it held, so nothing stays pressed on the screen.
  const onPointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') { touchRef.current = null; return }
    const point = pointAt(event.clientX, event.clientY)
    for (const button of buttonsRef.current) if (point) send({ type: 'up', ...point, button: button as 'left' | 'middle' | 'right' })
    buttonsRef.current.clear()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!controlling) return
    const press = {
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      altGraph: event.getModifierState?.('AltGraph') ?? false,
      isComposing: event.nativeEvent.isComposing,
    }
    // The browser's own paste carries the user's clipboard, which the paste listener sends as text.
    if (isPasteShortcut(press, mac)) { event.stopPropagation(); return }
    const input = keyInput(press, mac)
    // Keys that name nothing (a modifier alone) are left alone; everything else, Tab and Escape
    // included, belongs to the workspace rather than to the dialog or the page.
    if (!input) return
    event.preventDefault()
    event.stopPropagation()
    send(input)
  }

  const ready = phase.kind === 'ready'
  const label = controlling
    ? ui("Workspace screen. Your clicks and keys go to the workspace.")
    : ui("Workspace screen, live")

  return (
    <div
      ref={regionRef}
      tabIndex={ready ? 0 : -1}
      role={ready ? (controlling ? 'application' : 'img') : undefined}
      aria-label={ready ? label : undefined}
      aria-busy={phase.kind === 'loading' || (ready && !picture) ? true : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={(event) => { if (event.pointerType !== 'touch' && buttonsRef.current.size > 0) onPointerCancel(event) }}
      onContextMenu={(event) => { if (controlling) event.preventDefault() }}
      onKeyDown={onKeyDown}
      onPaste={(event) => {
        if (!controlling) return
        event.preventDefault()
        const text = event.clipboardData.getData('text/plain')
        if (text) onPaste(text)
      }}
      style={{ aspectRatio: `${width} / ${height}` }}
      className={cn(
        'relative w-full min-h-0 shrink-0 overflow-hidden rounded-md border bg-muted/40 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring',
        controlling && 'touch-none ring-2 ring-primary/70 focus-visible:ring-primary',
      )}
    >
      {ready && picture && (
        <img src={picture} alt="" draggable={false} className="pointer-events-none absolute inset-0 size-full object-contain" />
      )}
      {(phase.kind === 'loading' || (ready && !picture)) && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span className="sr-only">{ui("Loading the screen…")}</span>
        </div>
      )}
      {ready && picture && reconnecting && (
        <div className="absolute inset-x-0 bottom-2 flex justify-center">
          <span className="flex items-center gap-1.5 rounded-full bg-background/90 px-2.5 py-1 text-xs text-muted-foreground shadow-sm">
            <Loader2 className="size-3 animate-spin" />{ui("Reconnecting…")}
          </span>
        </div>
      )}
      {(phase.kind === 'none' || phase.kind === 'unavailable' || phase.kind === 'error') && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <MonitorOff className="size-6 text-muted-foreground" />
          <p className="max-w-md text-sm text-muted-foreground">
            {phase.kind === 'none'
              ? ui("No workspace is running for this chat. The screen is there while the agent's workspace is, and goes when the workspace shuts down after sitting idle.")
              : phase.kind === 'unavailable'
                ? ui("This workspace has no screen.")
                : ui("Couldn't load the screen.")}
          </p>
          {phase.kind !== 'unavailable' && (
            <Button size="sm" variant="outline" onClick={onRetry}>{ui("Try again")}</Button>
          )}
        </div>
      )}
    </div>
  )
}

/** For a touch screen or a narrow window: a field to type text into the workspace, and the keys a phone keyboard lacks. */
function TouchKeys({ send, sendText }: { send: (event: ScreenInputEvent) => void; sendText: (text: string) => void }) {
  const [text, setText] = useState('')
  const submit = () => {
    if (!text) return
    sendText(text)
    setText('')
  }
  const keys: Array<[string, string]> = [['enter', ui("Enter")], ['backspace', ui("Backspace")], ['tab', ui("Tab")], ['escape', ui("Esc")]]
  return (
    <div className="flex flex-col gap-2">
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); submit() }}>
        <Input
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label={ui("Text to type in the workspace")}
          placeholder={ui("Type here, then send")}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="send"
        />
        <Button type="submit" size="icon" disabled={!text} aria-label={ui("Type in the workspace")}>
          <SendHorizontal />
        </Button>
      </form>
      <div role="group" aria-label={ui("Keys")} className="flex flex-wrap gap-2">
        {keys.map(([keys, label]) => (
          <Button key={keys} type="button" size="sm" variant="outline" onClick={() => send({ type: 'key', keys })}>{label}</Button>
        ))}
      </div>
    </div>
  )
}
