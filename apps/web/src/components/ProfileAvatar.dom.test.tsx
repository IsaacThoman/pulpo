// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/runtime-resource', () => ({ useRuntimeImageUrl: (url: string | null) => ({ url }) }))
import { ProfileAvatar } from './ProfileAvatar'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('uploaded profile pictures', () => {
  it('shows circular initials while loading, then displays all image corners with no fallback underneath', async () => {
    let loader: HTMLImageElement | undefined
    vi.stubGlobal('Image', vi.fn(function () { loader = document.createElement('img'); return loader }))
    const view = render(<ProfileAvatar name="Isaac Thoman" avatarUrl="/api/users/1/avatar?v=2" />)
    expect(view.getByText('IT').className).toContain('rounded-full')
    Object.defineProperties(loader!, { complete: { value: true }, naturalWidth: { value: 512 } })
    await act(async () => loader?.dispatchEvent(new Event('load')))
    const image = await view.findByAltText("Isaac Thoman's profile picture")
    expect(image.className).toContain('object-contain')
    expect(image.parentElement?.className).toContain('rounded-none')
    expect(image.parentElement?.className).not.toContain('rounded-full')
    expect(view.queryByText('IT')).toBeNull()

    view.rerender(<ProfileAvatar name="Isaac Thoman" avatarUrl="/api/users/1/avatar?v=3" />)
    await waitFor(() => expect(view.queryByText('IT')).not.toBeNull())
    await act(async () => loader?.dispatchEvent(new Event('error')))
    expect(view.queryByRole('img')).toBeNull()
    expect(view.getByText('IT')).toBeTruthy()
  })
})
