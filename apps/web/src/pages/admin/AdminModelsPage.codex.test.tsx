import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ManagedCodexModelsSection, ManagedCodexSettingsEditor } from './AdminModelsPage'

describe('managed Codex models section', () => {
  it('shows restricted context settings without full model controls', () => {
    const markup = renderToStaticMarkup(<ManagedCodexModelsSection models={[{
      id: 'codex:gpt-test', name: 'GPT Test', upstreamModelId: 'gpt-test', contextWindow: 200_000,
      maxOutputTokens: 32_000, compactionThresholdTokens: 100_000, compactionRetainedTurns: 4,
      maximumCompactionThresholdTokens: 195_904,
    }]} onEdit={() => undefined} />)
    expect(markup).toContain('Managed Codex models')
    expect(markup).toContain('compacts at')
    expect(markup).toContain('Context settings')
    expect(markup).not.toContain('Disable')
    expect(markup).not.toContain('Pricing')
    expect(markup).not.toContain('Apply to all')
  })

  it('shows safe limits and no control for disabling compaction', () => {
    const markup = renderToStaticMarkup(<ManagedCodexSettingsEditor model={{
      id: 'codex:gpt-test', name: 'GPT Test', upstreamModelId: 'gpt-test', contextWindow: 200_000,
      maxOutputTokens: 32_000, compactionThresholdTokens: 100_000, compactionRetainedTurns: 4,
      maximumCompactionThresholdTokens: 195_904,
    }} onChange={() => undefined} />)
    expect(markup).toContain('Automatic context compaction')
    expect(markup).toContain('50%')
    expect(markup).toContain('Recent exchanges kept')
    expect(markup).not.toContain('Enable context compaction')
    expect(markup).not.toContain('Disable')
  })
})
