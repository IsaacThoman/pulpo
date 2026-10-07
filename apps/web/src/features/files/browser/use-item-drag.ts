import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { FileNode } from '@pulpo/contracts'
import { create } from 'zustand'

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
  /** Grid tiles keep their shape and stay under the pointer where they were grabbed. */
  tile: boolean
}

/**
 * Whether Files items are being dragged anywhere, so drop targets outside the browser (the
 * sidebar's shortcut area) can appear only while a drag is in progress.
 */
export const useFileDragActive = create<{ active: boolean; target: string | null }>()(() => ({ active: false, target: null }))

const IDLE: ItemDragState = { phase: 'idle', nodes: [], origins: [], start: { x: 0, y: 0 }, releasedAt: null, homes: [], tile: false }

/**
 * An item's rectangle in the view the drag started in. The same folder can be open on the page
 * and in the side panel, so a document-wide lookup could find the other view's copy.
 */
function rowRect(id: string, scope: ParentNode): DOMRect | null {
  return scope.querySelector<HTMLElement>(`[data-file-id="${CSS.escape(id)}"]`)?.getBoundingClientRect() ?? null
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
  /** Items are grid tiles: the drag shows the tile itself instead of a compact chip. */
  tile?: boolean
  /**
   * A freely arranged view: released over this element's empty space, the items move there.
   * `delta` is how far they travelled in the element's own coordinates, scrolling included.
   */
  canvas?: {
    element: () => HTMLElement | null
    onMove: (nodes: FileNode[], delta: { x: number; y: number }) => void
  }
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

  // Where the pointer grabbed a tile, relative to its corner; null for the compact chip.
  const grab = useRef<{ x: number; y: number } | null>(null)
  const positionChip = useCallback(() => {
    const chip = chipRef.current
    if (!chip) return
    // A tile stays under the pointer where it was grabbed, so it shows where it will land. The
    // compact chip's top-left corner sits at the cursor tip. The overlay ignores the pointer, so
    // it never blocks hit-testing for drop targets.
    const x = grab.current ? pointer.current.x - grab.current.x : pointer.current.x + CHIP_OFFSET_PX
    const y = grab.current ? pointer.current.y - grab.current.y : pointer.current.y + CHIP_OFFSET_PX
    chip.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }, [])

  const setTarget = (target: string | null) => {
    activeTargetRef.current = target
    setActiveTarget(target)
    useFileDragActive.setState({ target })
  }

  // The active drag, set synchronously so a release before React re-renders is still handled.
  const session = useRef<ItemDragState | null>(null)
  const scrollStart = useRef<{ element: HTMLElement | null; left: number; top: number }>({ element: null, left: 0, top: 0 })
  // The view the drag started in; item rectangles are looked up only there.
  const scope = useRef<ParentNode>(document)

  const finish = useCallback((dropped: boolean) => {
    cleanup.current?.()
    cleanup.current = null
    const current = session.current
    session.current = null
    useFileDragActive.setState({ active: false, target: null })
    if (!current) return
    const target = activeTargetRef.current
    setTarget(null)
    const releasedAt = chipRef.current?.firstElementChild?.getBoundingClientRect() ?? null
    const canvas = optionsRef.current.canvas
    const canvasElement = canvas?.element()
    const over = document.elementFromPoint(pointer.current.x, pointer.current.y)
    if (dropped && target !== null) {
      const targetId = target === 'root' ? null : target
      setState({ ...current, phase: 'dropping', releasedAt })
      optionsRef.current.onDrop(current.nodes, targetId)
    } else if (dropped && canvas && canvasElement && over && canvasElement.contains(over)) {
      // Rearranging: the items land where they were dropped, with no fly-back.
      const scroller = scrollStart.current
      canvas.onMove(current.nodes, {
        x: pointer.current.x - current.start.x + (scroller.element ? scroller.element.scrollLeft - scroller.left : 0),
        y: pointer.current.y - current.start.y + (scroller.element ? scroller.element.scrollTop - scroller.top : 0),
      })
      setState(IDLE)
    } else {
      const homes = current.nodes.map((node, index) => rowRect(node.id, scope.current) ?? current.origins[index] ?? current.origins[0]!)
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
      const { x, y } = pointer.current
      const edgeSpeed = (position: number, start: number, end: number) => position < start + AUTOSCROLL_EDGE_PX
        ? -Math.ceil(AUTOSCROLL_MAX_SPEED * (1 - Math.max(0, position - start) / AUTOSCROLL_EDGE_PX))
        : position > end - AUTOSCROLL_EDGE_PX
          ? Math.ceil(AUTOSCROLL_MAX_SPEED * (1 - Math.max(0, end - position) / AUTOSCROLL_EDGE_PX))
          : 0
      const vertical = edgeSpeed(y, bounds.top, bounds.bottom)
      if (vertical) viewport.scrollTop += vertical
      // Sideways only where the content scrolls sideways (a freely arranged grid).
      if (viewport.scrollWidth > viewport.clientWidth) {
        const sideways = edgeSpeed(x, bounds.left, bounds.right)
        if (sideways) viewport.scrollLeft += sideways
      }
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
        viewport = (event.target as Element).closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
        scope.current = viewport ?? document
        const origins = nodes.map((item) => rowRect(item.id, scope.current)).filter((rect): rect is DOMRect => Boolean(rect))
        scrollStart.current = { element: viewport, left: viewport?.scrollLeft ?? 0, top: viewport?.scrollTop ?? 0 }
        document.body.style.userSelect = 'none'
        window.getSelection()?.removeAllRanges()
        const tile = Boolean(optionsRef.current.tile && origins[0])
        grab.current = tile ? { x: startX - origins[0]!.left, y: startY - origins[0]!.top } : null
        session.current = { phase: 'dragging', nodes, origins, start: { x: startX, y: startY }, releasedAt: null, homes: [], tile }
        setState(session.current)
        useFileDragActive.setState({ active: true })
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
