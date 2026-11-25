// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SearchSettings } from './SearchSettings'

afterEach(cleanup)

describe('SearchSettings', () => {
  it('opens Pulpo Search and its preference panels in a new tab', () => {
    render(<SearchSettings searchUrl="https://search.pulpo.test" />)
    const link = (name: string) => screen.getByRole('link', { name })
    expect(link('Open Pulpo Search').getAttribute('href')).toBe('https://search.pulpo.test/')
    expect(link('Edit preferences').getAttribute('href')).toBe('https://search.pulpo.test/#settings')
    expect(link('Manage bangs').getAttribute('href')).toBe('https://search.pulpo.test/#bangs')
    expect(link('Set up').getAttribute('href')).toBe('https://search.pulpo.test/#browser')
    for (const anchor of screen.getAllByRole('link')) {
      expect(anchor.getAttribute('target')).toBe('_blank')
      expect(anchor.getAttribute('rel')).toContain('noopener')
    }
  })
})
