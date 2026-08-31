import { beforeEach, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { useCatalog } from '@/stores/catalog'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PublicRecentUsagePanel, PublicTopModelsPanel } from './PublicUsagePanels'

describe('public usage model icons', () => {
  beforeEach(() => useCatalog.setState({ models: [], loaded: true, agentAvailable: false }))

  it('uses record model metadata when the model is absent from the viewer catalog', () => {
    const markup = renderToStaticMarkup(<TooltipProvider>
      <PublicRecentUsagePanel
        records={[{
          id: 'usage-1',
          createdAt: '2026-08-31T05:34:13.000Z',
          participant: { id: 'user-1', displayName: 'Isaac', username: 'isaac', avatarUrl: null, profileColor: null },
          model: { id: 'codex:gpt-5.6-sol', name: 'GPT-5.6 Sol', logo: 'openai' },
          inputTokens: 24,
          outputTokens: 0,
          costMicros: 300,
          inferenceReferenceCostMicros: 300,
          subscriptionCoveredMicros: 0,
        }]}
        nextCursor={null}
        loadingMore={false}
        onLoadMore={() => undefined}
      />
    </TooltipProvider>)

    expect(markup).toContain('/ai-icons/openai.svg')
    expect(markup).not.toContain('/pulpo-smiley.png')
  })

  it('uses activity model metadata for top models outside the viewer catalog', () => {
    const markup = renderToStaticMarkup(<PublicTopModelsPanel models={[{
      modelId: 'codex:gpt-5.6-sol',
      name: 'GPT-5.6 Sol',
      logo: 'openai',
      calls: 3,
      costMicros: 400,
    }]} />)

    expect(markup).toContain('/ai-icons/openai.svg')
    expect(markup).not.toContain('/pulpo-smiley.png')
  })
})
