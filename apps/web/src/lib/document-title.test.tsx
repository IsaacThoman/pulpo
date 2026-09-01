// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDocumentTitle } from './document-title'

function DocumentTitle({ title }: { title?: string | null }) {
  useDocumentTitle(title)
  return null
}

afterEach(() => {
  cleanup()
  document.title = 'Pulpo'
})

describe('useDocumentTitle', () => {
  it('sets the supplied title exactly and updates it', () => {
    const view = render(<DocumentTitle title="First thread" />)
    expect(document.title).toBe('First thread')

    const titleSetter = vi.spyOn(document, 'title', 'set')
    view.rerender(<DocumentTitle title="Renamed thread" />)

    expect(document.title).toBe('Renamed thread')
    expect(titleSetter).toHaveBeenCalledOnce()
    expect(titleSetter).toHaveBeenCalledWith('Renamed thread')
    titleSetter.mockRestore()
  })

  it.each([undefined, null, '', '   '])('uses Pulpo when the title is %s', (title) => {
    render(<DocumentTitle title={title} />)
    expect(document.title).toBe('Pulpo')
  })

  it('restores Pulpo when the titled view unmounts', () => {
    const view = render(<DocumentTitle title="Thread title" />)
    view.unmount()

    expect(document.title).toBe('Pulpo')
  })
})
