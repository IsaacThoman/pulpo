import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OnlineUsersMenuStatus } from './OnlineUsersMenuStatus'

function markup(props: Parameters<typeof OnlineUsersMenuStatus>[0]) {
  return renderToStaticMarkup(<OnlineUsersMenuStatus {...props} />)
}

describe('online users menu status', () => {
  it('renders singular and plural user counts', () => {
    expect(markup({ onlineCount: 1, onlineLoading: false, onlineError: false })).toContain('1 user online')
    expect(markup({ onlineCount: 4, onlineLoading: false, onlineError: false })).toContain('4 users online')
  })

  it('renders loading and unavailable states before a count is available', () => {
    expect(markup({ onlineLoading: true, onlineError: false })).toContain('Checking users online…')
    expect(markup({ onlineLoading: false, onlineError: true })).toContain('Online users unavailable')
  })

  it('stays at the top of the account menu and refreshes when the menu opens', () => {
    const source = readFileSync(new URL('./Sidebar.tsx', import.meta.url), 'utf8')
    const status = source.indexOf('<OnlineUsersMenuStatus')
    const firstNavigationItem = source.indexOf("{accountNavItem('usage'", status)

    expect(status).toBeGreaterThan(-1)
    expect(status).toBeLessThan(firstNavigationItem)
    expect(source).toContain("if (open) refreshOnlineCount()")
  })
})
