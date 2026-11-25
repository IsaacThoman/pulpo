import { useEffect, useRef, useState } from 'react'
import { DEMO_TIMELINE, frameAt, stillFrame } from './timeline'

/** Open on a readable still. Play from the selected scene to the end, with pause and resume. */
export function useDemoFrame() {
  const timeline = DEMO_TIMELINE
  const [frame, setFrame] = useState(() => stillFrame(timeline, timeline.scenes[0]!.scene.id, 'done'))
  const [playing, setPlaying] = useState(false)
  const elapsed = useRef<number | null>(null)

  function select(id: string) {
    setPlaying(false)
    elapsed.current = null
    setFrame(stillFrame(timeline, id, id === 'models' ? 'picker' : 'done'))
  }

  function togglePlayback() {
    if (!playing && elapsed.current === null) {
      elapsed.current = timeline.scenes[frame.scene]!.startAt
    }
    setPlaying(!playing)
  }

  useEffect(() => {
    if (!playing) return
    const start = elapsed.current
    if (start === null) return
    const lastScene = timeline.scenes.at(-1)!
    const end = lastScene.startAt + lastScene.endAt
    let request = 0
    let last = performance.now()
    let shown = ''

    const tick = (now: number) => {
      // A background tab resumes where it left off.
      const nextTime = Math.min((elapsed.current ?? start) + Math.min(now - last, 100), end)
      last = now
      elapsed.current = nextTime
      const next = frameAt(timeline, nextTime)
      const key = JSON.stringify(next)
      if (key !== shown) {
        shown = key
        setFrame(next)
      }
      if (nextTime < end) {
        request = requestAnimationFrame(tick)
      } else {
        elapsed.current = null
        setPlaying(false)
      }
    }
    request = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(request)
  }, [playing, timeline])

  return { timeline, frame, playing, select, togglePlayback }
}
