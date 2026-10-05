import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { FileNodeIcon } from '../FileNodeIcon'
import type { ItemDrag } from './use-item-drag'

const EASE_OUT = 'cubic-bezier(0.2, 0, 0, 1)'
const LIFT_MS = 220
const RETURN_MS = 340
const DROP_MS = 160

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

const px = (value: number) => `${value}px`

/**
 * Drag visuals: the pressed row lifts off and shrinks into a chip that follows the pointer
 * (stacked, with a count, for several items). Released over nothing, each item flies back to
 * its row; dropped on a folder, the chip shrinks away into it.
 */
export function FileDragOverlay({ drag }: { drag: ItemDrag }) {
  const { state, chipRef, positionChip, settle } = drag
  const ghosts = useRef<Array<HTMLDivElement | null>>([])
  const primary = state.nodes[0]

  // Lift: start the chip at the first item's rectangle; a row morphs into the compact chip.
  useLayoutEffect(() => {
    if (state.phase !== 'dragging') return
    positionChip()
    const card = chipRef.current?.querySelector<HTMLElement>('[data-drag-card]')
    const origin = state.origins[0]
    if (!card || !origin || reducedMotion()) return
    const chip = card.getBoundingClientRect()
    // A tile keeps its shape and only lifts; a list row morphs into the compact chip.
    card.animate(state.tile ? [
      { transform: `translate(${px(origin.left - chip.left)}, ${px(origin.top - chip.top)})`, opacity: 0.85 },
      { transform: 'translate(0, 0)', opacity: 1 },
    ] : [
      { transform: `translate(${px(origin.left - chip.left)}, ${px(origin.top - chip.top)})`, width: px(origin.width), height: px(origin.height), opacity: 0.85 },
      { transform: 'translate(0, 0)', width: px(chip.width), height: px(chip.height), opacity: 1 },
    ], { duration: LIFT_MS, easing: EASE_OUT })
    // Only on the transition into dragging; later renders must not replay the lift.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase])

  // Return: every dragged item flies from the chip back to its row, then fades away.
  useLayoutEffect(() => {
    if (state.phase !== 'returning') return
    const from = state.releasedAt
    if (!from || reducedMotion()) {
      settle()
      return
    }
    const animations = state.homes.map((home, index) => ghosts.current[index]?.animate([
      { transform: `translate(${px(from.left - home.left)}, ${px(from.top - home.top)})`, width: px(from.width), height: px(from.height), opacity: 1 },
      { transform: 'translate(0, 0)', width: px(home.width), height: px(home.height), opacity: 0.9, offset: 0.8 },
      { transform: 'translate(0, 0)', width: px(home.width), height: px(home.height), opacity: 0 },
    ], { duration: RETURN_MS, delay: index * 30, easing: EASE_OUT, fill: 'both' }))
    void Promise.all(animations.map((animation) => animation?.finished)).catch(() => undefined).then(settle)
  }, [settle, state.homes, state.phase, state.releasedAt])

  // Drop: the chip shrinks into the folder it was released on.
  useLayoutEffect(() => {
    if (state.phase !== 'dropping') return
    const card = chipRef.current?.querySelector<HTMLElement>('[data-drag-card]')
    if (!card || reducedMotion()) {
      settle()
      return
    }
    const animation = chipRef.current!.animate(
      [{ opacity: 1, scale: '1' }, { opacity: 0, scale: '0.7' }],
      { duration: DROP_MS, easing: 'ease-in', fill: 'forwards' },
    )
    void animation.finished.catch(() => undefined).then(settle)
  }, [chipRef, settle, state.phase])

  if (state.phase === 'idle' || !primary) return null
  const count = state.nodes.length

  return createPortal(
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60]">
      {(state.phase === 'dragging' || state.phase === 'dropping') && (
        <div ref={chipRef} className="absolute top-0 left-0 origin-top-left will-change-transform">
          {count > 1 && <div className={cn('absolute inset-0 translate-x-1.5 translate-y-1.5 border bg-popover shadow-md', state.tile ? 'rounded-xl' : 'rounded-lg')} />}
          {state.tile ? (
            <div data-drag-card className="relative flex w-32 flex-col items-center gap-2 rounded-xl border bg-popover px-3 pt-6 pb-3 text-center text-sm text-popover-foreground shadow-xl">
              <FileNodeIcon node={primary} className="size-11" />
              <span className="line-clamp-2 w-full break-words">{primary.name}</span>
            </div>
          ) : (
            <div data-drag-card className="relative flex h-9 w-56 items-center gap-2 overflow-hidden rounded-lg border bg-popover px-3 text-sm text-popover-foreground shadow-xl">
              <FileNodeIcon node={primary} className="size-4" />
              <span className="min-w-0 truncate">{primary.name}</span>
            </div>
          )}
          {count > 1 && (
            <span className="absolute -top-2 -right-2 grid h-5 min-w-5 place-items-center rounded-full bg-sky-600 px-1 text-[11px] font-semibold text-white tabular-nums shadow">
              {count}
            </span>
          )}
        </div>
      )}
      {state.phase === 'returning' && state.homes.map((home, index) => {
        const node = state.nodes[index]!
        return (
          <div
            key={node.id}
            ref={(element) => { ghosts.current[index] = element }}
            className={cn(
              'fixed flex overflow-hidden border bg-popover text-sm text-popover-foreground shadow-lg',
              state.tile ? 'flex-col items-center gap-2 rounded-xl px-3 pt-6 pb-3 text-center' : 'items-center gap-3 rounded-md px-3',
            )}
            style={{ left: home.left, top: home.top, width: home.width, height: home.height }}
          >
            <FileNodeIcon node={node} className={state.tile ? 'size-11' : 'size-5'} />
            <span className={state.tile ? 'line-clamp-2 w-full break-words' : 'min-w-0 truncate'}>{node.name}</span>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
