// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { FileNode } from '@pulpo/contracts'
import { afterEach, expect, it, vi } from 'vitest'
import { InlineRename } from './InlineRename'

afterEach(cleanup)

const node = { id: 'notes', parentId: null, kind: 'doc', name: 'Notes.md' } as FileNode

it('leaves Enter and Escape to an IME while it composes, then commits the name', () => {
  const onCommit = vi.fn(async () => true)
  const onCancel = vi.fn()
  render(<InlineRename node={node} onCommit={onCommit} onCancel={onCancel} />)
  const input = screen.getByRole('textbox', { name: 'Name' })
  fireEvent.change(input, { target: { value: '議事録.md' } })
  // Chrome confirms a candidate with a composing Enter; Safari sends it after, as key code 229.
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229, isComposing: true })
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
  fireEvent.keyDown(input, { key: 'Escape', keyCode: 229, isComposing: true })
  expect(onCommit).not.toHaveBeenCalled()
  expect(onCancel).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 })
  expect(onCommit).toHaveBeenCalledWith('議事録.md')
})
