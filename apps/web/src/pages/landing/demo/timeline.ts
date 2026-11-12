import captured from './script.json'

export type Device = 'web' | 'phone'

export interface DemoModel {
  id: string
  name: string
  lab: string
  /** A file in public/ai-icons. */
  icon: string
  /** The composer's labels for this model. Captured for the models a scene uses. */
  controls?: { reasoning: string; speed: string; agent: string }
}

/** One thing a person does in a scene. A scene ends with a `send`. */
export type DemoBeat =
  /** `keyMs` overrides the pace for this text, for a long message that should not hold up the scene. */
  | { type: 'type'; on: Device; text: string; keyMs?: number }
  /** Choosing another model: from the browser's model list, or the phone's menu. */
  | { type: 'pick'; on: Device; model: string }
  | { type: 'send'; on: Device }

/** One line of an agent's work: its workspace starting, a tool call, or a thought. `atMs` is after sending. */
export type DemoStep = { atMs: number; durationMs: number; duration: string } & (
  | { kind: 'workspace' }
  | { kind: 'tool'; tool: string; detail: string }
  | { kind: 'reasoning'; title: string; text: string }
)

export interface DemoAttachment { name: string; meta: string; src: string; width: number; height: number }

export interface DemoScene {
  id: string
  /** The model the scene opens on. */
  model: string
  /** Plays the response this many times faster than it really arrived. */
  speed?: number
  /** The same for the answer's text alone, once it starts. Below 1 slows the stream so it can be watched. */
  answerSpeed?: number
  /** Milliseconds from sending to the answer's first text, replacing the real wait; what comes before it (steps) scales to fit. */
  thinkMs?: number
  /**
   * Streams the answer's text at an even pace over this many milliseconds instead of its real chunk timing, which can
   * arrive in bursts. Use it or `answerSpeed`, not both.
   */
  streamMs?: number
  /** `top` keeps the start of the conversation in view while the answer arrives, instead of following its newest line. */
  scroll?: 'top'
  beats: DemoBeat[]
  /** The chat's generated title, which replaces the prompt in the sidebar. */
  title: string
  /** Milliseconds after sending: the other device opening the chat, each step and streamed chunk, the end, the title. */
  response: {
    followMs: number
    completedMs: number
    titleMs: number
    /** How long the agent worked, as the chat words it. Present when it used a workspace. */
    worked?: string
    steps?: DemoStep[]
    attachment?: DemoAttachment
    deltas: Array<[number, string]>
  }
}

/**
 * The demo's script. `scripts/capture-landing-demo.mjs` plays each scene against a real instance and fills in
 * what came back; beats, speeds, pacing, and suggestions are written by hand.
 */
export interface DemoScript {
  user: { name: string; username: string; initials: string }
  sidebar: string[]
  suggestions: string[]
  /** Files in public/ai-icons for the lab marks down the side of the browser's model list. */
  labs: string[]
  /** The phone's model menu, in order, plus any other model a scene uses. */
  models: DemoModel[]
  pacing: {
    startMs: number
    webKeyMs: number
    webKeyJitterMs: number
    /** How far a draft or model choice made on one device trails on the other. */
    syncLagMs: number
    handoffMs: number
    phoneKeyMs: number
    /** How long the phone's model menu stays open before a choice is tapped. */
    pickMs: number
    /** How long the chosen model stays highlighted before the menu closes. Defaults to the length of a tap. */
    pickedMs?: number
    sendDelayMs: number
    streamLagMs: number
    holdMs: number
    fadeMs: number
  }
  scenes: DemoScene[]
}

export const DEMO_SCRIPT = captured as unknown as DemoScript

export type DemoTouch = 'composer' | 'send' | 'model' | 'pick'

/** A scene with every moment worked out, in milliseconds from the scene's start. */
export interface CompiledScene {
  scene: DemoScene
  /** Milliseconds from the start of the loop. */
  startAt: number
  duration: number
  prompt: string
  startModel: DemoModel
  endModel: DemoModel
  /** The draft after each keystroke, and the device it was typed on. */
  drafts: Array<{ at: number; on: Device; text: string }>
  /** Phone keyboard presses. */
  keys: Array<{ at: number; key: string }>
  touches: Array<{ at: number; kind: DemoTouch }>
  /** When the phone's caret is placed at the end of the draft, if the phone types. */
  caretAt: number | null
  picker: { on: Device; openAt: number; pressAt: number; closeAt: number } | null
  sendAt: number
  sendOn: Device
  steps: Array<{ at: number; step: DemoStep }>
  deltas: Array<[number, string]>
  doneAt: number
  titleAt: number
  endAt: number
}

export interface DemoTimeline {
  script: DemoScript
  scenes: CompiledScene[]
  duration: number
}

export interface DeviceFrame {
  modelId: string
  /** Still composing, or showing the started chat. */
  chat: boolean
  draft: string
  /** How many of the scene's steps are listed so far. */
  steps: number
  /** The agent is still at it: steps are listed but no answer has begun. */
  working: boolean
  answer: string
  streaming: boolean
  attachment: boolean
}

export interface DemoFrame {
  /** Index into the timeline's scenes, and how far through it the loop is. */
  scene: number
  progress: number
  web: DeviceFrame
  phone: DeviceFrame
  /** The open model list and the device showing it, with the model about to be chosen. */
  picker: { on: Device; pressed: string | null } | null
  /** The phone keyboard key under the finger, if any. */
  pressedKey: string | null
  touch: DemoTouch | null
  /** Whether the phone's caret has been placed at the end of the draft. */
  phoneCaret: boolean
  /** The new chat's sidebar entry: its prompt at first, then the generated title. */
  sidebarTitle: string | null
  /** Fades each scene in and out. */
  opacity: number
}

const KEY_DOWN_MS = 110
const TOUCH_MS = 140
const FADE_IN_MS = 300

export function modelById(script: DemoScript, id: string): DemoModel {
  const model = script.models.find((candidate) => candidate.id === id)
  if (!model) throw new Error(`The demo script has no model ${id}`)
  return model
}

function compileScene(script: DemoScript, scene: DemoScene, startAt: number): CompiledScene {
  const { pacing } = script
  const { response } = scene
  const speed = scene.speed ?? 1
  const compiled: CompiledScene = {
    scene, startAt, duration: 0, prompt: '', startModel: modelById(script, scene.model), endModel: modelById(script, scene.model),
    drafts: [], keys: [], touches: [], caretAt: null, picker: null, sendAt: 0, sendOn: 'web', steps: [], deltas: [], doneAt: 0, titleAt: 0, endAt: 0,
  }
  let at = pacing.startMs
  let typed = 0
  let sent = false
  for (const beat of scene.beats) {
    if (sent) throw new Error(`Scene ${scene.id} has beats after its send`)
    if (beat.type === 'type' && beat.on === 'web') {
      for (const character of beat.text) {
        // Uneven like real typing, but the same on every run.
        const keyMs = beat.keyMs ?? pacing.webKeyMs
        const spread = Math.round(pacing.webKeyJitterMs * (keyMs / pacing.webKeyMs))
        const jitter = spread ? ((typed++ * 7919) % (2 * spread + 1)) - spread : 0
        at += keyMs + jitter
        compiled.prompt += character
        compiled.drafts.push({ at, on: 'web', text: compiled.prompt })
      }
    } else if (beat.type === 'type') {
      if (compiled.prompt) {
        // A draft that arrived from elsewhere leaves the caret at its start, so the phone taps the end first.
        at += pacing.handoffMs
        compiled.touches.push({ at, kind: 'composer' })
        compiled.caretAt = at
        at += pacing.phoneKeyMs
      } else {
        compiled.caretAt ??= 0
      }
      for (const character of beat.text) {
        at += beat.keyMs ?? pacing.phoneKeyMs
        compiled.keys.push({ at, key: character })
        compiled.prompt += character
        compiled.drafts.push({ at, on: 'phone', text: compiled.prompt })
      }
    } else if (beat.type === 'pick') {
      at += pacing.handoffMs
      const openAt = at
      at += pacing.pickMs
      if (beat.on === 'phone') compiled.touches.push({ at: openAt, kind: 'model' }, { at, kind: 'pick' })
      const pickedMs = pacing.pickedMs ?? TOUCH_MS
      compiled.picker = { on: beat.on, openAt, pressAt: at, closeAt: at + pickedMs }
      compiled.endModel = modelById(script, beat.model)
      at += pickedMs
    } else {
      at += pacing.sendDelayMs
      compiled.sendAt = at
      compiled.sendOn = beat.on
      if (beat.on === 'phone') compiled.touches.push({ at, kind: 'send' })
      sent = true
    }
  }
  if (!sent) throw new Error(`Scene ${scene.id} never sends its message`)
  if (scene.streamMs !== undefined && scene.answerSpeed !== undefined) throw new Error(`Scene ${scene.id} sets both streamMs and answerSpeed`)
  const firstText = response.deltas[0]?.[0] ?? response.completedMs
  // Everything before the first text plays at the scene's speed, or stretches to fit `thinkMs`.
  const beforeSpeed = scene.thinkMs ? firstText / scene.thinkMs : speed
  const after = (ms: number) => compiled.sendAt + ms / beforeSpeed
  compiled.steps = (response.steps ?? []).map((step) => ({ at: after(step.atMs), step }))
  if (scene.streamMs !== undefined) {
    // An even pace by characters, ending `streamMs` after the first text.
    const total = response.deltas.reduce((sum, [, delta]) => sum + delta.length, 0)
    let written = 0
    compiled.deltas = response.deltas.map(([, delta]) => {
      const at = after(firstText) + (scene.streamMs! * written) / total
      written += delta.length
      return [at, delta]
    })
    compiled.doneAt = after(firstText) + scene.streamMs + (response.completedMs - (response.deltas.at(-1)?.[0] ?? firstText)) / speed
  } else {
    // The answer's text keeps its own pace from its first chunk on.
    const answerAfter = (ms: number) => after(firstText) + (ms - firstText) / (scene.answerSpeed ?? speed)
    compiled.deltas = response.deltas.map(([offset, delta]) => [answerAfter(offset), delta])
    compiled.doneAt = answerAfter(response.completedMs)
  }
  compiled.titleAt = compiled.doneAt + (response.titleMs - response.completedMs) / speed
  compiled.endAt = compiled.doneAt + pacing.holdMs
  compiled.duration = compiled.endAt + pacing.fadeMs
  return compiled
}

export function buildTimeline(script: DemoScript = DEMO_SCRIPT): DemoTimeline {
  const scenes: CompiledScene[] = []
  let startAt = 0
  for (const scene of script.scenes) {
    const compiled = compileScene(script, scene, startAt)
    scenes.push(compiled)
    startAt += compiled.duration
  }
  return { script, scenes, duration: startAt }
}

/** The captured script, compiled once for every place the page shows it. */
export const DEMO_TIMELINE = buildTimeline()

/** The whole scene at a moment of the loop. Pure, so the demo can be tested, scrubbed, and frozen. */
export function frameAt(timeline: DemoTimeline, elapsedMs: number): DemoFrame {
  const { script, duration } = timeline
  const { pacing } = script
  const loopMs = ((elapsedMs % duration) + duration) % duration
  const index = Math.max(0, timeline.scenes.findLastIndex((candidate) => candidate.startAt <= loopMs))
  const compiled = timeline.scenes[index]!
  const { scene } = compiled
  const ms = loopMs - compiled.startAt

  const device = (name: Device): DeviceFrame => {
    // What this device did itself shows at once; what the other did arrives a moment later.
    const seen = (origin: Device, at: number) => at + (origin === name ? 0 : pacing.syncLagMs) <= ms
    const chat = ms >= compiled.sendAt + (compiled.sendOn === name ? 0 : scene.response.followMs)
    const time = ms - (name === 'phone' ? pacing.streamLagMs : 0)
    let answer = ''
    if (chat) {
      for (const [at, delta] of compiled.deltas) {
        if (at > time) break
        answer += delta
      }
    }
    const steps = chat ? compiled.steps.filter((step) => step.at <= time).length : 0
    const draft = chat ? '' : compiled.drafts.findLast((entry) => seen(entry.on, entry.at))?.text ?? ''
    const picked = compiled.picker !== null && seen(compiled.picker.on, compiled.picker.closeAt)
    return {
      modelId: (picked ? compiled.endModel : compiled.startModel).id,
      chat,
      draft,
      steps,
      working: chat && compiled.steps.length > 0 && !answer,
      answer,
      streaming: chat && time < compiled.doneAt,
      // The file follows the finished answer, so it does not slide down under the text as it streams.
      attachment: Boolean(scene.response.attachment) && chat && time >= compiled.doneAt,
    }
  }
  const web = device('web')
  const phone = device('phone')

  const { picker } = compiled
  const pressedKey = compiled.keys.find((key) => ms >= key.at - KEY_DOWN_MS && ms < key.at)?.key ?? null
  const touch = compiled.touches.find((entry) => Math.abs(ms - entry.at) < TOUCH_MS)?.kind ?? null
  const fadeOut = ms > compiled.endAt ? 1 - (ms - compiled.endAt) / pacing.fadeMs : 1
  return {
    scene: index,
    // In half-percent steps, so a frame only changes when something visible does.
    progress: Math.round((ms / compiled.duration) * 200) / 200,
    web,
    phone,
    picker: picker && ms >= picker.openAt && ms < picker.closeAt ? { on: picker.on, pressed: ms >= picker.pressAt - TOUCH_MS ? compiled.endModel.id : null } : null,
    pressedKey,
    touch,
    phoneCaret: compiled.caretAt !== null && ms >= compiled.caretAt,
    sidebarTitle: web.chat ? (ms >= compiled.titleAt ? scene.title : compiled.prompt) : null,
    opacity: Math.max(0, Math.min(ms / FADE_IN_MS, fadeOut, 1)),
  }
}

/** A scene held at one moment: its opening new chat, its model list open, or finished. For stills and reduced motion. */
export function stillFrame(timeline: DemoTimeline, sceneId: string, moment: 'start' | 'picker' | 'done'): DemoFrame {
  const compiled = timeline.scenes.find((candidate) => candidate.scene.id === sceneId)
  if (!compiled) throw new Error(`The demo script has no scene ${sceneId}`)
  if (moment === 'start') return { ...frameAt(timeline, compiled.startAt), opacity: 1 }
  if (moment === 'picker') {
    if (!compiled.picker) throw new Error(`Scene ${sceneId} never opens the model menu`)
    return frameAt(timeline, compiled.startAt + (compiled.picker.openAt + compiled.picker.pressAt) / 2)
  }
  return frameAt(timeline, compiled.startAt + Math.min(compiled.endAt, Math.max(compiled.doneAt, compiled.titleAt) + 1))
}
