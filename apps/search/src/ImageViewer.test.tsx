// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchResponse } from './api'
import { homeLocation } from './navigation'
import { loadPreferences } from './preferences'
import { Results } from './Results'

const data: SearchResponse = {
  provider: 'kagi',
  results: [
    { url: 'https://photos.example.com/octopus', title: 'Reef octopus', snippet: '', imageUrl: 'https://cdn.example.com/reef.jpg' },
    { url: 'https://aquarium.example.com/octopus', title: 'Giant octopus', snippet: '', imageUrl: 'https://cdn.example.com/giant.jpg' },
    { url: 'https://hidden.example.com/octopus', title: 'Hidden octopus', snippet: '', imageUrl: 'https://cdn.example.com/hidden.jpg' },
  ],
}

beforeEach(() => {
  // jsdom has dialog elements but does not implement their native focus behavior.
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.open = true }
    HTMLDialogElement.prototype.close = function () { this.open = false }
  }
})
afterEach(cleanup)

describe('image result viewer', () => {
  it('opens the chosen image, browses the visible order, and restores focus on Escape', () => {
    const onQuery = vi.fn()
    render(<Results data={data} location={{ ...homeLocation, category: 'images', query: 'octopus' }}
      preferences={{ ...loadPreferences(), newTab: true, domains: { 'hidden.example.com': 'hide' } }} setDomain={vi.fn()} onQuery={onQuery} />)

    const opener = screen.getByRole('button', { name: 'Preview image: Reef octopus' })
    opener.focus()
    fireEvent.click(opener)
    const dialog = screen.getByRole('dialog', { name: 'Image preview' })
    const overlay = within(dialog)
    expect(overlay.getByRole('img', { name: 'Reef octopus' }).getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(overlay.getByText('1 of 2')).toBeDefined()
    expect(overlay.getByRole('button', { name: 'Previous image' }).getAttribute('aria-disabled')).toBe('true')

    fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    const nextImage = overlay.getByRole('img', { name: 'Giant octopus' })
    expect(nextImage.getAttribute('src')).toBe('https://cdn.example.com/giant.jpg')
    expect(overlay.getByRole('button', { name: 'Next image' }).getAttribute('aria-disabled')).toBe('true')
    const source = overlay.getByRole('link', { name: 'Visit site' })
    expect(source.getAttribute('href')).toBe('https://aquarium.example.com/octopus')
    expect(source.getAttribute('target')).toBe('_blank')
    expect(source.getAttribute('rel')).toBe('noreferrer')
    const original = overlay.getByRole('link', { name: 'Open image' })
    expect(original.getAttribute('href')).toBe('https://cdn.example.com/giant.jpg')
    expect(original.getAttribute('target')).toBe('_blank')
    expect(original.getAttribute('rel')).toBe('noreferrer')
    fireEvent.error(nextImage)
    expect(overlay.getByText('Image unavailable')).toBeDefined()
    expect(overlay.getByRole('link', { name: 'Visit site' })).toBe(source)

    fireEvent.click(overlay.getByRole('button', { name: 'Previous image' }))
    expect(overlay.getByRole('img', { name: 'Reef octopus' })).toBeDefined()
    overlay.getByRole('button', { name: 'Close image preview' }).focus()
    fireEvent(dialog, new Event('cancel', { cancelable: true }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(onQuery).not.toHaveBeenCalled()
  })

  it('keeps ordinary source links and handles an invalid preview URL', () => {
    render(<Results data={{ ...data, results: [{ ...data.results[0], imageUrl: 'javascript:alert(1)' }] }}
      location={{ ...homeLocation, category: 'images', query: 'octopus' }} preferences={loadPreferences()}
      setDomain={vi.fn()} onQuery={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'Reef octopus' }).getAttribute('href')).toBe(data.results[0].url)
    fireEvent.click(screen.getByRole('button', { name: 'Preview image: Reef octopus' }))
    const overlay = within(screen.getByRole('dialog'))
    expect(overlay.getByText('Image unavailable')).toBeDefined()
    expect(overlay.queryByRole('img')).toBeNull()
    expect(overlay.queryByRole('link', { name: 'Open image' })).toBeNull()
    expect(overlay.getByRole('link', { name: 'Visit site' }).hasAttribute('target')).toBe(false)
  })

  it('loads the small preview in the grid and falls back to it if the large preview fails', () => {
    const imageUrl = data.results[0].imageUrl
    const thumbnailUrl = 'https://cdn.example.com/preview.jpg'
    render(<Results data={{ ...data, results: [{ ...data.results[0], thumbnailUrl, imageDimensions: { width: 960, height: 640 } }] }}
      location={{ ...homeLocation, category: 'images', query: 'octopus' }} preferences={loadPreferences()}
      setDomain={vi.fn()} onQuery={vi.fn()} />)

    const trigger = screen.getByRole('button', { name: 'Preview image: Reef octopus' })
    expect(trigger.querySelector('img')?.src).toBe(thumbnailUrl)
    fireEvent.click(trigger)
    const overlay = within(screen.getByRole('dialog'))
    expect(overlay.getByText(/960 × 640/)).toBeDefined()
    const large = overlay.getByRole('img', { name: 'Reef octopus' })
    expect(large.getAttribute('src')).toBe(imageUrl)
    fireEvent.error(large)
    const thumbnail = overlay.getByRole('img', { name: 'Reef octopus' })
    expect(thumbnail.getAttribute('src')).toBe(thumbnailUrl)
    fireEvent.error(thumbnail)
    expect(overlay.getByText('Image unavailable')).toBeDefined()
  })

  it('shows the reported license, creator, attribution, and original source only for the current licensed image', () => {
    const attribution = '“Reef octopus” by Reef Lab is licensed under CC BY-SA 4.0.'
    const imageLicense = {
      code: 'by-sa', version: '4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/',
      creator: 'Reef Lab', creatorUrl: 'https://photos.example.com/creators/reef-lab', attribution,
    }
    render(<Results data={{ ...data, results: [{ ...data.results[0], imageLicense }, data.results[1]] }}
      location={{ ...homeLocation, category: 'images', query: 'octopus' }} preferences={{ ...loadPreferences(), newTab: true }}
      setDomain={vi.fn()} onQuery={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview image: Reef octopus' }))
    const dialog = screen.getByRole('dialog')
    const overlay = within(dialog)
    const details = within(overlay.getByRole('group', { name: 'Image reuse details' }))
    expect(details.getByText('Reported license')).toBeDefined()
    expect(details.getByRole('link', { name: 'CC BY-SA 4.0' }).getAttribute('href')).toBe(imageLicense.url)
    expect(details.getByRole('link', { name: 'Reef Lab' }).getAttribute('href')).toBe(imageLicense.creatorUrl)
    fireEvent.click(details.getByText('Attribution'))
    expect(details.getByText(attribution).parentElement?.hasAttribute('open')).toBe(true)
    expect(details.getByText('Check the original source before reusing this image.')).toBeDefined()
    expect(overlay.getByRole('link', { name: 'Visit original source' }).getAttribute('href')).toBe(data.results[0].url)
    fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    expect(overlay.queryByRole('group', { name: 'Image reuse details' })).toBeNull()
    expect(overlay.getByRole('link', { name: 'Visit site' }).getAttribute('href')).toBe(data.results[1].url)
  })

  it('keeps reported license text without promoting unsafe creator or license links', () => {
    const imageLicense = { code: 'cc0', version: '1.0', url: 'javascript:alert(1)', creator: 'Reef Lab', creatorUrl: 'data:text/html,bad' }
    render(<Results data={{ ...data, results: [{ ...data.results[0], imageLicense }] }}
      location={{ ...homeLocation, category: 'images', query: 'octopus' }} preferences={loadPreferences()}
      setDomain={vi.fn()} onQuery={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview image: Reef octopus' }))
    const details = within(screen.getByRole('group', { name: 'Image reuse details' }))
    expect(details.getByText(/CC0 1\.0 · By Reef Lab/)).toBeDefined()
    expect(details.queryByRole('link')).toBeNull()
  })

  it('copies supplied attribution with the original source and license after the clipboard action', async () => {
    const attribution = 'Reef octopus by Reef Lab, CC BY 4.0.'
    const imageLicense = { code: 'by', version: '4.0', url: 'https://creativecommons.org/licenses/by/4.0/', attribution }
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Clipboard permission denied'))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    try {
      render(<Results data={{ ...data, results: [{ ...data.results[0], imageLicense }] }}
        location={{ ...homeLocation, category: 'images', query: 'octopus' }} preferences={loadPreferences()}
        setDomain={vi.fn()} onQuery={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: 'Preview image: Reef octopus' }))
      const details = within(screen.getByRole('group', { name: 'Image reuse details' }))
      fireEvent.click(details.getByText('Attribution'))
      expect(writeText).not.toHaveBeenCalled()
      const copy = details.getByRole('button', { name: 'Copy attribution' })
      fireEvent.click(copy)
      expect(writeText).toHaveBeenCalledExactlyOnceWith([attribution, data.results[0].url, imageLicense.url].join('\n'))
      expect(await details.findByText('Attribution copied')).toBeDefined()
      fireEvent.click(copy)
      expect(await details.findByText('Select the attribution text to copy it.')).toBeDefined()
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
      else Reflect.deleteProperty(navigator, 'clipboard')
    }
  })
})
