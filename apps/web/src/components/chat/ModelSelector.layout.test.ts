import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Codex provider rail placement', () => {
  it('keeps Codex fixed below Favorites and above the provider divider', () => {
    const source = readFileSync(new URL('./ModelSelector.tsx', import.meta.url), 'utf8')
    const favorites = source.indexOf('<TooltipContent side="right">{t(\'chat.favorites\')}</TooltipContent>')
    const codex = source.indexOf('{codexAvailable && (')
    const divider = source.indexOf('<div className="my-1 h-px w-5 shrink-0 bg-border" />')
    const reorderableProviders = source.indexOf('{providers.map((p) => {')
    expect(favorites).toBeGreaterThan(-1)
    expect(favorites).toBeLessThan(codex)
    expect(codex).toBeLessThan(divider)
    expect(divider).toBeLessThan(reorderableProviders)
    expect(source).toContain("filter((id) => id !== CODEX_LAB_ID)")
  })
})
