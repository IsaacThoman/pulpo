import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { DEMO_TIMELINE, frameAt, stillFrame, type DemoFrame, type DemoTimeline } from './timeline'

/**
 * Plays the demo while `root` is on screen. The first render (and the pre-rendered page) shows the opening
 * scene; visitors who prefer reduced motion get each scene's finished state instead, and `seek` still moves
 * between scenes for them.
 */
export function useDemoFrame(root: RefObject<HTMLElement | null>): { timeline: DemoTimeline; frame: DemoFrame; seek: (scene: number) => void } {
  const timeline = DEMO_TIMELINE
  const [frame, setFrame] = useState(() => frameAt(timeline, 0))
  const elapsed = useRef(0)
  const still = useRef(false)

  const seek = useCallback((scene: number) => {
    const target = timeline.scenes[scene]
    if (!target) return
    elapsed.current = target.startAt
    setFrame(still.current ? stillFrame(timeline, target.scene.id, 'done') : frameAt(timeline, target.startAt))
  }, [timeline])

  useEffect(() => {
    const element = root.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      still.current = true
      setFrame(stillFrame(timeline, timeline.scenes[0]!.scene.id, 'done'))
      return
    }
    let request = 0
    let last = 0
    let visible = false
    let shown = ''
    const tick = (now: number) => {
      // Capped so a throttled tab resumes where it left off instead of skipping ahead.
      elapsed.current += Math.min(now - last, 100)
      last = now
      const next = frameAt(timeline, elapsed.current)
      const key = JSON.stringify(next)
      if (key !== shown) {
        shown = key
        setFrame(next)
      }
      request = requestAnimationFrame(tick)
    }
    const run = () => {
      cancelAnimationFrame(request)
      if (!visible || document.hidden) return
      last = performance.now()
      request = requestAnimationFrame(tick)
    }
    const observer = new IntersectionObserver(([entry]) => {
      visible = Boolean(entry?.isIntersecting)
      run()
    }, { threshold: 0.15 })
    observer.observe(element)
    document.addEventListener('visibilitychange', run)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', run)
      cancelAnimationFrame(request)
    }
  }, [root, timeline])

  return { timeline, frame, seek }
}
