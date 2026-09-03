// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SidebarLogo } from './SidebarLogo'

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterEach(cleanup)
afterAll(() => vi.unstubAllGlobals())

function renderLogo(overrides: Partial<Parameters<typeof SidebarLogo>[0]> = {}) {
  const props: Parameters<typeof SidebarLogo>[0] = {
    collapsed: false,
    collapsedTooltipOpen: false,
    onlineCount: 4,
    onlineLoading: false,
    onlineError: false,
    onCollapsedTooltipOpenChange: vi.fn(),
    onPresenceIntent: vi.fn(),
    onClick: vi.fn(),
    ...overrides,
  }
  return { props, ...render(<TooltipProvider delayDuration={0}><SidebarLogo {...props} /></TooltipProvider>) }
}

describe('sidebar logo tooltip', () => {
  it('requests presence on expanded hover and renders the plural count', async () => {
    const { props } = renderLogo()
    const logo = screen.getByRole('button', { name: 'Home' })

    fireEvent.pointerEnter(logo)
    fireEvent.focus(logo)

    expect(props.onPresenceIntent).toHaveBeenCalled()
    expect(await screen.findByText('4 users online')).toBeTruthy()
  })

  it('renders the singular count', async () => {
    renderLogo({ onlineCount: 1 })
    fireEvent.focus(screen.getByRole('button', { name: 'Home' }))

    expect(await screen.findByText('1 user online')).toBeTruthy()
  })

  it('keeps the expand tooltip and skips presence requests while collapsed', async () => {
    const { props } = renderLogo({ collapsed: true, collapsedTooltipOpen: true })
    const logo = screen.getByRole('button', { name: 'Expand sidebar' })

    fireEvent.pointerEnter(logo)
    fireEvent.focus(logo)

    expect(props.onPresenceIntent).not.toHaveBeenCalled()
    expect(await screen.findByText('Expand sidebar')).toBeTruthy()
    expect(screen.queryByText('4 users online')).toBeNull()
  })
})
