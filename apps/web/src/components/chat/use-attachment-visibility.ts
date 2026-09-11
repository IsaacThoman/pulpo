import { useEffect, useRef, useState } from 'react'

/** Observe scroll containers as well as the viewport; offscreen images release their URLs. */
export function useAttachmentVisibility() {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { rootMargin: '100px' })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return { ref, visible }
}
