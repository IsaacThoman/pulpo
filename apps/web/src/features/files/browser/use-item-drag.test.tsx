// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileNode } from '@pulpo/contracts'
import { useItemDrag } from './use-item-drag'

const doc: FileNode = {
  id: 'd1', parentId: null, kind: 'doc', name: 'Notes.md', status: 'ready', mimeType: null, sizeBytes: 0, revision: 0,
  trashedAt: null, createdAt: '', updatedAt: '', systemRole: null, color: null, icon: null,
}

function Row({ resolveNodes }: { resolveNodes: (node: FileNode) => FileNode[] }) {
  const drag = useItemDrag({ resolveNodes, canDrop: () => false, onDrop: () => {} })
  return <div role="option" aria-selected={false} onPointerDown={(event) => drag.onPointerDown(event, doc)}>
    Notes.md
    <span data-file-menu-button aria-hidden="true">⋯</span>
  </div>
}

// jsdom has no PointerEvent; a mouse event of the same name carries the fields the hook reads.
function pointer(target: Element | Window, type: string, clientX: number, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY })
  Object.defineProperty(event, 'pointerType', { value: 'mouse' })
  fireEvent(target, event)
}

/** Presses at (10, 10) and travels well past the drag threshold. */
function pressAndMove(target: Element) {
  pointer(target, 'pointerdown', 10, 10)
  pointer(window, 'pointermove', 60, 60)
}

afterEach(() => {
  pointer(window, 'pointerup', 60, 60)
  cleanup()
  vi.useRealTimers()
  document.body.style.userSelect = ''
})

describe('useItemDrag', () => {
  it('lifts an item pressed and moved on the row', () => {
    vi.useFakeTimers()
    const resolveNodes = vi.fn(() => [doc])
    render(<Row resolveNodes={resolveNodes} />)
    pressAndMove(screen.getByRole('option'))
    expect(resolveNodes).toHaveBeenCalledTimes(1)
  })

  it('leaves the menu affordance to open the menu instead of starting a drag', () => {
    vi.useFakeTimers()
    const resolveNodes = vi.fn(() => [doc])
    const view = render(<Row resolveNodes={resolveNodes} />)
    pressAndMove(view.container.querySelector('[data-file-menu-button]')!)
    expect(resolveNodes).not.toHaveBeenCalled()
  })
})
