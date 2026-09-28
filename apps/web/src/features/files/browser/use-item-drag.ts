import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { FileNode } from '@pulpo/contracts'

/** Pointer travel before a press on an item becomes a drag, so plain clicks still select. */
const DRAG_THRESHOLD_PX = 5
const AUTOSCROLL_EDGE_PX = 56
const AUTOSCROLL_MAX_SPEED = 18
/** Gap between the cursor tip and the drag chip's top-left corner. */
const CHIP_OFFSET_PX = 2

export type ItemDragPhase = 'idle' | 'dragging' | 'returning' | 'dropping'

export interface ItemDragState {
  phase: ItemDragPhase
  nodes: FileNode[]
  /** Where each dragged row sat when the drag started; the chip lifts off from the first one. */
  origins: DOMRect[]
  /** Pointer position at the moment the drag started. */
  start: { x: number; y: number }
  /** Chip rectangle at release, for the return or drop animation. */
  releasedAt: DOMRect | null
  /** Current row rectangles at release, where cancelled items fly back to. */
  homes: DOMRect[]
}

const IDLE: ItemDragState = { phase: 'idle', nodes: [], origins: [], start: { x: 0, y: 0 }, releasedAt: null, homes: [] }

function rowRect(id: string): DOMRect | null {
  return document.querySelector<HTMLElement>(`[data-file-id="${CSS.escape(id)}"]`)?.getBoundingClientRect() ?? null
}

/**
 * Drive-style dragging for items already in Files: a press that travels a few pixels lifts the
 * selection into a chip that follows the pointer, highlights folders and breadcrumbs under it
 * (`data-drop-target`), and either drops into one or flies back when released elsewhere.
 * Files dragged in from the OS still use native drag and drop.
 */
export function useItemDrag(options: {
  /** Items to drag when pressing `node`; selects it first when it was not selected. */
  resolveNodes: (node: FileNode) => FileNode[]
  canDrop: (targetId: string | null, nodes: FileNode[]) => boolean
  onDrop: (nodes: FileNode[], targetId: string | null) => void
}) {
  const [state, setState] = useState<ItemDragState>(IDLE)
  const [activeTarget, setActiveTarget] = useState<string | null>(null)
  const chipRef = useRef<HTMLDivElement | null>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const suppressClick = useRef(false)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const stateRef = useRef(state)
  stateRef.current = state
  const activeTargetRef = useRef<string | null>(null)
  const cleanup = useRef<(() => void) | null>(null)

  const positionChip = useCallback(() => {
    const chip = chipRef.current
    // The chip's top-left corner sits at the cursor tip; the overlay ignores the pointer, so it
    // never blocks hit-testing for drop targets.
    if (chip) chip.style.transform = `translate3d(${pointer.current.x + CHIP_OFFSET_PX}px, ${pointer.current.y + CHIP_OFFSET_PX}px, 0)`
  }, [])

  const setTarget = (target: string | null) => {
    activeTargetRef.current = target
    setActiveTarget(target)
  }

  // The active drag, set synchronously so a release before React re-renders is still handled.
  const session = useRef<ItemDragState | null>(null)

  const finish = useCallback((dropped: boolean) => {
    cleanup.current?.()
    cleanup.current = null
    const current = session.current
    session.current = null
    if (!current) return
    const target = activeTargetRef.current
    setTarget(null)
    const releasedAt = chipRef.current?.firstElementChild?.getBoundingClientRect() ?? null
    if (dropped && target !== null) {
      const targetId = target === 'root' ? null : target
      setState({ ...current, phase: 'dropping', releasedAt })
      optionsRef.current.onDrop(current.nodes, targetId)
    } else {
      const homes = current.nodes.map((node, index) => rowRect(node.id) ?? current.origins[index] ?? current.origins[0]!)
      setState({ ...current, phase: 'returning', releasedAt, homes })
    }
  }, [])

  /** Called by the overlay when its return or drop animation ends. */
  const settle = useCallback(() => setState(IDLE), [])

  const onPointerDown = useCallback((event: ReactPointerEvent, node: FileNode) => {
    if (event.button !== 0 || event.pointerType === 'touch' || stateRef.current.phase !== 'idle') return
    if ((event.target as Element).closest('button, input')) return
    const startX = event.clientX
    const startY = event.clientY
    let started = false
    let frame = 0
    let viewport: HTMLElement | null = null

    const autoscroll = () => {
      frame = requestAnimationFrame(autoscroll)
      if (!viewport) return
      const bounds = viewport.getBoundingClientRect()
      const { y } = pointer.current
      const speed = y < bounds.top + AUTOSCROLL_EDGE_PX
        ? -Math.ceil(AUTOSCROLL_MAX_SPEED * (1 - Math.max(0, y - bounds.top) / AUTOSCROLL_EDGE_PX))
        : y > bounds.bottom - AUTOSCROLL_EDGE_PX
          ? Math.ceil(AUTOSCROLL_MAX_SPEED * (1 - Math.max(0, bounds.bottom - y) / AUTOSCROLL_EDGE_PX))
          : 0
      if (speed) viewport.scrollTop += speed
    }

    const hitTest = () => {
      const element = document.elementFromPoint(pointer.current.x, pointer.current.y)
      const target = element?.closest<HTMLElement>('[data-drop-target]')?.dataset.dropTarget ?? null
      const nodes = session.current?.nodes ?? []
      const allowed = target !== null && optionsRef.current.canDrop(target === 'root' ? null : target, nodes)
      const next = allowed ? target : null
      if (next !== activeTargetRef.current) setTarget(next)
    }

    const move = (moveEvent: PointerEvent) => {
      pointer.current = { x: moveEvent.clientX, y: moveEvent.clientY }
      if (!started) {
        if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD_PX) return
        started = true
        const nodes = optionsRef.current.resolveNodes(node)
        const origins = nodes.map((item) => rowRect(item.id)).filter((rect): rect is DOMRect => Boolean(rect))
        viewport = (event.target as Element).closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
        document.body.style.userSelect = 'none'
        window.getSelection()?.removeAllRanges()
        session.current = { phase: 'dragging', nodes, origins, start: { x: startX, y: startY }, releasedAt: null, homes: [] }
        setState(session.current)
        frame = requestAnimationFrame(autoscroll)
      }
      moveEvent.preventDefault()
      positionChip()
      hitTest()
    }
    const up = () => {
      if (!started) {
        detach()
        return
      }
      // The click that follows this release must not change the selection.
      suppressClick.current = true
      window.setTimeout(() => { suppressClick.current = false }, 0)
      finish(true)
    }
    const key = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== 'Escape' || !started) return
      keyEvent.preventDefault()
      keyEvent.stopPropagation()
      finish(false)
    }
    const detach = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('keydown', key, true)
      cancelAnimationFrame(frame)
      document.body.style.userSelect = ''
    }
    cleanup.current = detach
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('keydown', key, true)
  }, [finish, positionChip])

  useEffect(() => () => cleanup.current?.(), [])

  return {
    state,
    activeTarget,
    chipRef,
    pointer,
    positionChip,
    settle,
    onPointerDown,
    draggingIds: new Set(state.phase === 'idle' ? [] : state.nodes.map((node) => node.id)),
    /** True for the click that ends a drag; item click handlers should ignore it. */
    consumeClick: () => suppressClick.current,
  }
}

export type ItemDrag = ReturnType<typeof useItemDrag>
