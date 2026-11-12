import { describe, expect, it } from 'vitest'
import { buildTimeline, DEMO_SCRIPT, DEMO_TIMELINE, frameAt, stillFrame, type DemoScript } from './timeline'

const script: DemoScript = {
  ...DEMO_SCRIPT,
  labs: ['openai.svg'],
  models: [
    { id: 'one', name: 'One', lab: 'Lab', icon: 'openai.svg', controls: { reasoning: 'Medium', speed: 'Auto', agent: 'Agent' } },
    { id: 'two', name: 'Two', lab: 'Lab', icon: 'claude-color.svg' },
  ],
  pacing: { startMs: 1000, webKeyMs: 100, webKeyJitterMs: 0, syncLagMs: 150, handoffMs: 500, phoneKeyMs: 200, pickMs: 600, sendDelayMs: 400, streamLagMs: 50, holdMs: 2000, fadeMs: 400 },
  scenes: [
    {
      id: 'sync',
      model: 'one',
      beats: [{ type: 'type', on: 'web', text: 'Hi' }, { type: 'type', on: 'phone', text: ' yo' }, { type: 'send', on: 'phone' }],
      title: 'Greeting',
      response: { followMs: 100, completedMs: 900, titleMs: 1500, deltas: [[500, '**Hel'], [700, 'lo**'], [800, ' there']] },
    },
    {
      id: 'agent',
      model: 'one',
      speed: 2,
      beats: [{ type: 'pick', on: 'phone', model: 'two' }, { type: 'type', on: 'web', text: 'Go', keyMs: 50 }, { type: 'send', on: 'web' }],
      title: 'Chart',
      response: {
        followMs: 100,
        completedMs: 4000,
        titleMs: 5000,
        worked: '4 seconds',
        steps: [
          { kind: 'workspace', atMs: 1000, durationMs: 50, duration: '0s' },
          { kind: 'tool', tool: 'bash', detail: 'python3 chart.py', atMs: 2000, durationMs: 800, duration: '1s' },
        ],
        attachment: { name: 'chart.png', meta: 'PNG · 1 KiB', src: '/landing/chart.png', width: 4, height: 3 },
        deltas: [[3600, 'Done.']],
      },
    },
  ],
}
const timeline = buildTimeline(script)
const [sync, agent] = timeline.scenes as [(typeof timeline.scenes)[number], (typeof timeline.scenes)[number]]

describe('landing demo timeline', () => {
  it('opens on an empty new chat on both screens', () => {
    const frame = frameAt(timeline, 0)
    const empty = { modelId: 'one', chat: false, draft: '', steps: 0, working: false, answer: '', streaming: false, attachment: false }

    expect(frame).toMatchObject({ scene: 0, progress: 0, web: empty, phone: empty, picker: null, sidebarTitle: null, opacity: 0 })
  })

  it('shows a draft on the other screen a moment after it is typed', () => {
    // 'H' is typed in the browser at 1100 ms.
    expect(frameAt(timeline, 1120).web.draft).toBe('H')
    expect(frameAt(timeline, 1120).phone.draft).toBe('')
    expect(frameAt(timeline, 1260).phone.draft).toBe('H')

    // The phone taps the end of the draft at 1700 ms and types its first character at 2100 ms.
    expect(sync.caretAt).toBe(1700)
    expect(frameAt(timeline, 1600).phoneCaret).toBe(false)
    expect(frameAt(timeline, 1700).touch).toBe('composer')
    expect(frameAt(timeline, 2050).pressedKey).toBe(' ')
    expect(frameAt(timeline, 2120).phone.draft).toBe('Hi ')
    expect(frameAt(timeline, 2120).web.draft).toBe('Hi')
    expect(frameAt(timeline, 2260).web.draft).toBe('Hi ')
  })

  it('starts the chat where it was sent, then on the other screen, and streams the same answer to both', () => {
    expect(sync.sendAt).toBe(2900)
    expect(frameAt(timeline, 2890).touch).toBe('send')
    expect(frameAt(timeline, 2950).phone.chat).toBe(true)
    expect(frameAt(timeline, 2950).web.chat).toBe(false)
    expect(frameAt(timeline, 3050).web).toMatchObject({ chat: true, draft: '', answer: '', streaming: true })
    expect(frameAt(timeline, 3050).sidebarTitle).toBe('Hi yo')

    expect(frameAt(timeline, 3420).web.answer).toBe('**Hel')
    expect(frameAt(timeline, 3420).phone.answer).toBe('')
    expect(frameAt(timeline, 3460).phone.answer).toBe('**Hel')

    expect(frameAt(timeline, 3900).web).toMatchObject({ answer: '**Hello** there', streaming: false })
    expect(frameAt(timeline, 3900).phone.answer).toBe('**Hello** there')
    expect(frameAt(timeline, 4400).sidebarTitle).toBe('Greeting')
  })

  it('fades a scene out and moves to the next', () => {
    expect(sync.duration).toBe(6200)
    expect(frameAt(timeline, 6000).opacity).toBeCloseTo(0.5)
    expect(frameAt(timeline, 6200)).toMatchObject({ scene: 1, progress: 0 })
    expect(agent.startAt).toBe(6200)
    expect(frameAt(timeline, timeline.duration)).toEqual(frameAt(timeline, 0))
  })

  it('changes the model on the phone first, then in the browser', () => {
    const at = (ms: number) => frameAt(timeline, agent.startAt + ms)

    // The menu opens at 1500 ms and the other model is tapped at 2100 ms.
    expect(agent.picker).toEqual({ on: 'phone', openAt: 1500, pressAt: 2100, closeAt: 2240 })
    expect(at(1400).picker).toBeNull()
    expect(at(1500)).toMatchObject({ touch: 'model', picker: { on: 'phone', pressed: null } })
    expect(at(2100)).toMatchObject({ touch: 'pick', picker: { pressed: 'two' } })
    expect(at(2250)).toMatchObject({ picker: null, phone: { modelId: 'two' }, web: { modelId: 'one' } })
    expect(at(2400).web.modelId).toBe('two')
    expect(stillFrame(timeline, 'agent', 'picker').picker).toEqual({ on: 'phone', pressed: null })
    expect(stillFrame(timeline, 'agent', 'start')).toMatchObject({ opacity: 1, picker: null, phone: { chat: false, modelId: 'one' } })
  })

  it('plays an agent run at its scene speed: steps, then the answer and its file', () => {
    const at = (ms: number) => frameAt(timeline, agent.startAt + ms)

    // 'Go' is typed at 50 ms a key from 2240 ms and sent from the browser 400 ms later.
    expect(agent.sendAt).toBe(2740)
    expect(agent.sendOn).toBe('web')
    expect(at(2750)).toMatchObject({ touch: null, web: { chat: true }, phone: { chat: false } })
    // Steps recorded 1 s and 2 s after sending show after half that.
    expect(at(3200).web).toMatchObject({ steps: 0, working: true, answer: '' })
    expect(at(3250).web.steps).toBe(1)
    expect(at(3250).phone.steps).toBe(0)
    expect(at(3760).web.steps).toBe(2)
    expect(at(4550).web).toMatchObject({ steps: 2, working: false, answer: 'Done.', attachment: false, streaming: true })
    // The file shows once the answer has finished.
    expect(at(4750).web).toMatchObject({ streaming: false, attachment: true })
  })

  it('can slow the answer alone, leaving the steps before it at the scene speed', () => {
    const slowed = buildTimeline({ ...script, scenes: [{ ...script.scenes[1]!, answerSpeed: 0.5, response: { ...script.scenes[1]!.response, deltas: [[3600, 'Do'], [3800, 'ne.']] } }] })
    const [scene] = slowed.scenes as [(typeof slowed.scenes)[number]]

    // Steps and the first chunk still arrive at double speed: 3600 ms after sending becomes 1800 ms.
    expect(scene.steps.map((step) => step.at - scene.sendAt)).toEqual([500, 1000])
    expect(scene.deltas.map(([at]) => at - scene.sendAt)).toEqual([1800, 2200])
    // The 400 ms from first text to the end plays at half speed, and the title follows at double speed again.
    expect(scene.doneAt - scene.sendAt).toBe(2600)
    expect(scene.titleAt - scene.doneAt).toBe(500)
  })

  it('can shorten the wait for the first text and stream the answer evenly over a set time', () => {
    const base = script.scenes[1]!
    const retimed = buildTimeline({ ...script, scenes: [{ ...base, thinkMs: 900, streamMs: 1000, response: { ...base.response, deltas: [[3600, 'Do'], [3800, 'ne.']] } }] })
    const [scene] = retimed.scenes as [(typeof retimed.scenes)[number]]

    // The 3600 ms before the first text shrinks to 900 ms, and the steps in it shrink with it.
    expect(scene.steps.map((step) => step.at - scene.sendAt)).toEqual([250, 500])
    // Five characters over 1000 ms: 'ne.' starts two characters in, at 400 ms.
    expect(scene.deltas.map(([at]) => at - scene.sendAt)).toEqual([900, 1300])
    // The 200 ms from the last chunk to completion keeps the scene speed.
    expect(scene.doneAt - scene.sendAt).toBe(2000)
    expect(() => buildTimeline({ ...script, scenes: [{ ...base, streamMs: 1000, answerSpeed: 0.5 }] })).toThrow('both streamMs and answerSpeed')
  })

  it('opens the model list in the browser when the choice is made there, and the phone follows', () => {
    const onWeb = buildTimeline({ ...script, scenes: [{ ...script.scenes[1]!, beats: [{ type: 'pick', on: 'web', model: 'two' }, { type: 'type', on: 'web', text: 'Go' }, { type: 'send', on: 'web' }] }] })

    expect(frameAt(onWeb, 1500)).toMatchObject({ touch: null, picker: { on: 'web', pressed: null } })
    expect(frameAt(onWeb, 2100)).toMatchObject({ touch: null, picker: { on: 'web', pressed: 'two' } })
    expect(frameAt(onWeb, 2250)).toMatchObject({ picker: null, web: { modelId: 'two' }, phone: { modelId: 'one' } })
    expect(frameAt(onWeb, 2400).phone.modelId).toBe('two')

    // `pickedMs` holds the chosen model highlighted before the list closes.
    const held = buildTimeline({ ...script, pacing: { ...script.pacing, pickedMs: 500 }, scenes: onWeb.scenes.map((compiled) => compiled.scene) })
    expect(held.scenes[0]!.picker).toEqual({ on: 'web', openAt: 1500, pressAt: 2100, closeAt: 2600 })
    expect(frameAt(held, 2550)).toMatchObject({ picker: { on: 'web', pressed: 'two' }, web: { modelId: 'one' } })
    expect(frameAt(held, 2600)).toMatchObject({ picker: null, web: { modelId: 'two' } })
  })

  it('freezes a finished scene for stills and reduced motion', () => {
    expect(stillFrame(timeline, 'sync', 'done')).toMatchObject({ scene: 0, opacity: 1, sidebarTitle: 'Greeting', web: { answer: '**Hello** there', streaming: false } })
    expect(stillFrame(timeline, 'agent', 'done')).toMatchObject({ scene: 1, opacity: 1, phone: { modelId: 'two', steps: 2, answer: 'Done.', attachment: true } })
    expect(() => stillFrame(timeline, 'sync', 'picker')).toThrow('never opens the model menu')
    expect(() => stillFrame(timeline, 'missing', 'done')).toThrow('no scene missing')
  })

  it('rejects a scene that never sends or that goes on after sending', () => {
    const scene = script.scenes[0]!
    expect(() => buildTimeline({ ...script, scenes: [{ ...scene, beats: [{ type: 'type', on: 'web', text: 'Hi' }] }] })).toThrow('never sends')
    expect(() => buildTimeline({ ...script, scenes: [{ ...scene, beats: [{ type: 'send', on: 'web' }, { type: 'type', on: 'web', text: 'Hi' }] }] })).toThrow('after its send')
    expect(() => buildTimeline({ ...script, scenes: [{ ...scene, model: 'nope' }] })).toThrow('no model nope')
  })

  it('plays every captured scene to a complete answer', () => {
    expect(DEMO_TIMELINE.scenes.length).toBeGreaterThan(0)
    for (const { scene, duration } of DEMO_TIMELINE.scenes) {
      const answer = scene.response.deltas.map(([, delta]) => delta).join('')
      const done = stillFrame(DEMO_TIMELINE, scene.id, 'done')

      expect(answer.length).toBeGreaterThan(20)
      expect(done.web.answer).toBe(answer)
      expect(done.phone.answer).toBe(answer)
      expect(done.web.steps).toBe(scene.response.steps?.length ?? 0)
      // Short enough to sit through, long enough to read.
      expect(duration).toBeGreaterThan(6000)
      expect(duration).toBeLessThan(22000)
    }
    // The phone can only tap out lowercase letters and spaces.
    for (const beat of DEMO_SCRIPT.scenes.flatMap((scene) => scene.beats)) {
      if (beat.type === 'type' && beat.on === 'phone') expect(beat.text).toMatch(/^[a-z ]+$/)
    }
  })
})
