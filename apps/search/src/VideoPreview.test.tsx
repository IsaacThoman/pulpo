// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VideoPreview } from './VideoPreview'

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.open = true }
    HTMLDialogElement.prototype.close = function () { this.open = false }
  }
})
afterEach(cleanup)

describe('video result preview', () => {
  it('loads the isolated player only after selection and restores trigger focus on cancel', () => {
    const { container } = render(<VideoPreview title="NASA mission update" newTab={false}
      url="https://www.youtube.com/watch?v=M7lc1UVf-VE&autoplay=1&si=tracking" />)
    const trigger = screen.getByRole('button', { name: 'Watch here: NASA mission update' })
    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'NASA mission update' })
    const close = within(dialog).getByRole('button', { name: 'Close video preview' })
    expect(document.activeElement).toBe(close)
    const player = within(dialog).getByTitle('YouTube video player')
    expect(player.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?autoplay=0&playsinline=1')
    expect(player.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin')
    expect(player.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
    expect(player.getAttribute('allow')).not.toContain('autoplay')
    const watch = within(dialog).getByRole('link', { name: 'Watch on YouTube' })
    expect(watch.getAttribute('href')).toBe('https://www.youtube.com/watch?v=M7lc1UVf-VE')
    expect(watch.getAttribute('target')).toBeNull()
    expect(watch.getAttribute('rel')).toBe('noreferrer')
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(container.querySelector('iframe')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps a Vimeo source option while the player is open and respects the new-tab preference', () => {
    const { container } = render(<VideoPreview title="A guide to Vimeo" newTab url="https://vimeo.com/76979871" />)
    fireEvent.click(screen.getByRole('button', { name: 'Watch here: A guide to Vimeo' }))
    expect(screen.getByTitle('Vimeo video player').getAttribute('src'))
      .toBe('https://player.vimeo.com/video/76979871?autoplay=0&dnt=1')
    const watch = screen.getByRole('link', { name: 'Watch on Vimeo' })
    expect(watch.getAttribute('target')).toBe('_blank')
    expect(watch.getAttribute('href')).toBe('https://vimeo.com/76979871')
    fireEvent.click(screen.getByRole('button', { name: 'Close video preview' }))
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('offers no preview UI for unsupported results', () => {
    const { container } = render(<VideoPreview title="Unsupported result" newTab={false}
      url="https://www.youtube.com.example.org/watch?v=M7lc1UVf-VE" />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
  })
})
