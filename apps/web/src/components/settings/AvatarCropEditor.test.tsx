// @vitest-environment jsdom
import { fireEvent, render, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AvatarCropEditor } from './AvatarCropEditor'
import { DEFAULT_AVATAR_CROP } from './avatar-crop'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('animated crop preview', () => {
  it('keeps a live image and matches the full-image and zoomed crop geometry', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    const onChange = vi.fn()
    const view = render(<AvatarCropEditor imageUrl="blob:animated-gif" settings={{ ...DEFAULT_AVATAR_CROP, cropToCircle: false }} onChange={onChange} />)
    const img = view.container.querySelector('img')!
    Object.defineProperties(img, { naturalWidth: { value: 1000 }, naturalHeight: { value: 500 } })
    fireEvent.load(img)
    expect(view.container.querySelector('canvas')).toBeNull()
    expect(img.src).toBe('blob:animated-gif')
    expect(img.style.width).toBe('100%')
    expect(img.style.height).toBe('50%')
    expect(img.style.top).toBe('25%')
    expect(view.getByRole('img').className).toContain('rounded-none')
    view.rerender(<AvatarCropEditor imageUrl="blob:animated-gif" settings={{ ...DEFAULT_AVATAR_CROP, zoom: 2, offsetX: 256 }} onChange={onChange} />)
    expect(view.container.querySelector('img')).toBe(img)
    expect(img.style.width).toBe('400%')
    expect(img.style.left).toBe('-100%')
    expect(img.style.top).toBe('-50%')
    expect(view.getByRole('img').className).toContain('rounded-full')
    fireEvent.click(view.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_AVATAR_CROP, cropToCircle: false })
  })
})
