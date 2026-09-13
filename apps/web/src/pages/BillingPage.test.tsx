import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { BillingOptionCard } from './BillingPage'

// The page itself needs auth, router, and query providers; this covers the shared option-card shell.
vi.mock('@/lib/local-first/composer-sync', () => ({ clearWebComposerSync: vi.fn() }))

describe('BillingOptionCard', () => {
  it('renders the option label, title, description, body, and actions in order', () => {
    const html = renderToStaticMarkup(
      <BillingOptionCard icon={<span>icon</span>} eyebrow="Option 2 · Pay as you go" title="Credits" description="Buy credits whenever you need them." actions={<button>Add credits</button>}>
        <div>$11.84</div>
      </BillingOptionCard>,
    )

    const order = ['Option 2 · Pay as you go', 'Credits', 'Buy credits whenever you need them.', '$11.84', 'Add credits'].map((text) => html.indexOf(text))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
})
