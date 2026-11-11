// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it } from 'vitest'
import { Markdown } from './Markdown'

afterEach(cleanup)

const id = '00000000-0000-4000-8000-0000000000a1'

it('shows links to Files items as chips that open in the app', () => {
  render(<MemoryRouter><Markdown content={`See [Plan.md](/files/d/${id}) and [Notes](${window.location.origin}/files/f/${id}) or [elsewhere](https://example.com/files/d/${id})`} /></MemoryRouter>)
  const plan = screen.getByRole('link', { name: 'Plan.md' })
  expect(plan.getAttribute('href')).toBe(`/files/d/${id}`)
  expect(plan.getAttribute('target')).toBeNull()
  expect(plan.querySelector('.lucide-file-text')).not.toBeNull()
  expect(screen.getByRole('link', { name: 'Notes' }).querySelector('.lucide-folder')).not.toBeNull()
  expect(screen.getByRole('link', { name: 'elsewhere' }).getAttribute('target')).toBe('_blank')
})
