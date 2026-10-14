import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ManagedCodexModelsSection, ManagedCodexSettingsEditor } from './AdminModelsPage'

describe('managed Codex models section', () => {
  it('shows restricted context settings without full model controls', () => {
    const markup = renderToStaticMarkup(<ManagedCodexModelsSection models={[{
      id: 'codex:gpt-test', name: 'GPT Test', upstreamModelId: 'gpt-test', contextWindow: 200_000,
      maxOutputTokens: 32_000, minimumOutputReservationTokens: 8_000, compactionThresholdTokens: 100_000, compactionRetainedUserTokens: 20_000,
      maximumCompactionThresholdTokens: 180_000,
    }]} onEdit={() => undefined} />)
    expect(markup).toContain('Managed Codex models')
    expect(markup).toContain('compacts at')
    expect(markup).toContain('keeps 20.0K user-message tokens')
    expect(markup).not.toContain('exchanges')
    expect(markup).toContain('Model settings')
    expect(markup).not.toContain('Disable')
    expect(markup).not.toContain('Pricing')
    expect(markup).not.toContain('Apply to all')
  })

  it('shows safe limits and no control for disabling compaction', () => {
    const markup = renderToStaticMarkup(<ManagedCodexSettingsEditor model={{
      id: 'codex:gpt-test', name: 'GPT Test', upstreamModelId: 'gpt-test', contextWindow: 200_000,
      maxOutputTokens: 32_000, minimumOutputReservationTokens: 8_000, compactionThresholdTokens: 100_000, compactionRetainedUserTokens: 20_000,
      maximumCompactionThresholdTokens: 180_000,
    }} onChange={() => undefined} />)
    expect(markup).toContain('Automatic context compaction')
    expect(markup).toContain('50%')
    expect(markup).toContain('Kept user-message tokens')
    expect(markup).toContain('Recent user messages, up to this many tokens, are kept word for word next to the summary.')
    expect(markup).toContain('90% of the context window, whichever is lower')
    expect(markup).toMatch(/min="0" max="100000" step="1000"[^>]*value="20000"/)
    expect(markup).not.toContain('Recent exchanges kept')
    expect(markup).not.toContain('Enable context compaction')
    expect(markup).not.toContain('Disable')
  })
})
