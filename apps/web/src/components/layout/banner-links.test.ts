import { describe, expect, it } from 'vitest'
import { bannerSegments } from './banner-links'

describe('bannerSegments', () => {
  it('keeps plain copy as a single text segment', () => {
    expect(bannerSegments('Maintenance Sunday 03:00 UTC.')).toEqual([{ kind: 'text', text: 'Maintenance Sunday 03:00 UTC.' }])
  })

  it('links labelled and bare URLs, leaving trailing punctuation as text', () => {
    expect(bannerSegments('See the [status page](https://status.example.com) or https://example.com/notes.')).toEqual([
      { kind: 'text', text: 'See the ' },
      { kind: 'link', text: 'status page', href: 'https://status.example.com' },
      { kind: 'text', text: ' or ' },
      { kind: 'link', text: 'https://example.com/notes', href: 'https://example.com/notes' },
      { kind: 'text', text: '.' },
    ])
  })

  it('supports mailto links but leaves other schemes as text', () => {
    expect(bannerSegments('[Email us](mailto:help@example.com)')).toEqual([{ kind: 'link', text: 'Email us', href: 'mailto:help@example.com' }])
    expect(bannerSegments('[Click](javascript:alert(1))')).toEqual([{ kind: 'text', text: '[Click](javascript:alert(1))' }])
  })
})
