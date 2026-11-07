// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pageTitle, useDocumentTitle, useRouteDocumentTitle } from './document-title'

function DocumentTitle({ title }: { title?: string | null }) {
  useDocumentTitle(title)
  return null
}

function RouteTitle({ title, children }: { title?: string | null; children?: React.ReactNode }) {
  useRouteDocumentTitle(title)
  return children
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

describe('route titles', () => {
  it('formats page titles after the app name', () => {
    expect(pageTitle('Files')).toBe('Files – Pulpo')
    expect(pageTitle('Projects', 'Files')).toBe('Projects – Files – Pulpo')
    expect(pageTitle(null, ' ')).toBe('Pulpo')
  })

  it('shows the route title until a view sets its own, whichever mounts first', () => {
    const view = render(<RouteTitle title="Chat – Pulpo"><DocumentTitle title={null} /></RouteTitle>)
    expect(document.title).toBe('Chat – Pulpo')
    view.rerender(<RouteTitle title="Chat – Pulpo"><DocumentTitle title="Thread title" /></RouteTitle>)
    expect(document.title).toBe('Thread title')
    view.rerender(<RouteTitle title="Files – Pulpo" />)
    expect(document.title).toBe('Files – Pulpo')
    view.unmount()
    expect(document.title).toBe('Pulpo')
  })
})
