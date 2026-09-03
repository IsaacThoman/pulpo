import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OnlineUsersStatus } from './OnlineUsersStatus'

function markup(props: Parameters<typeof OnlineUsersStatus>[0]) {
  return renderToStaticMarkup(<OnlineUsersStatus {...props} />)
}

describe('online users status', () => {
  it('renders singular and plural user counts', () => {
    expect(markup({ onlineCount: 1, onlineLoading: false, onlineError: false })).toContain('1 user online')
    expect(markup({ onlineCount: 4, onlineLoading: false, onlineError: false })).toContain('4 users online')
  })

  it('renders loading and unavailable states before a count is available', () => {
    expect(markup({ onlineLoading: true, onlineError: false })).toContain('Checking users online…')
    expect(markup({ onlineLoading: false, onlineError: true })).toContain('Online users unavailable')
  })

  it('is rendered in the About settings section', () => {
    const settings = readFileSync(new URL('./SettingsModal.tsx', import.meta.url), 'utf8')
    const aboutSection = settings.indexOf("{section === 'about'")
    const status = settings.indexOf('<OnlineUsersStatus', aboutSection)

    expect(aboutSection).toBeGreaterThan(-1)
    expect(status).toBeGreaterThan(aboutSection)
  })
})
