import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import '../../src/index.css'
import i18n from '../../src/i18n'
import { RecentUsagePanel } from '../../src/components/usage/UsagePanels'
import { PublicRecentUsagePanel } from '../../src/components/usage/PublicUsagePanels'
import { StatsRow } from '../../src/components/usage/StatsRow'
import { Section, TextField } from '../../src/components/admin/kit'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../src/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '../../src/components/ui/popover'
import { TooltipProvider } from '../../src/components/ui/tooltip'

const params = new URLSearchParams(location.search)
await i18n.changeLanguage(params.get('locale') ?? 'en-US')
document.documentElement.classList.toggle('dark', params.has('dark'))
const records = Array.from({ length: 60 }, (_, index) => ({
  id: `usage-${index}`, timestamp: Date.parse('2026-09-14T18:40:03Z') - index * 60000,
  userId: 'audit-user', modelId: 'a-model-with-a-very-long-name-for-layout-testing',
  tokensIn: 487615, tokensOut: 29842, cost: 1234.5678,
  balanceAfter: 123456.78, latencyMs: 15000,
}))

export function Fixture() {
  const [open, setOpen] = useState(false)
  const [loads, setLoads] = useState(0)
  return <TooltipProvider><main style={{ width: '100%', maxWidth: Number(params.get('width') ?? 976), padding: 16, margin: 'auto' }}>
    <div data-testid="stats"><StatsRow calls={1234567} tokens={4994440123} cost={123456.789} /></div>
    <RecentUsagePanel records={records} showUser={params.has('user')} showBalance={params.has('balance')}
      displayName={() => 'Alexandria Catherine Montgomery'}
      users={[{ id: 'audit-user', name: 'Alexandria Catherine Montgomery', username: 'alexandria', email: 'audit@example.test', role: 'user', balance: 123456.78, joinedAt: 0, blocked: false, avatarUrl: null, profileColor: null }]}
      nextCursor="next" onLoadMore={() => setLoads((value) => value + 1)} />
    <output data-testid="loads">{loads}</output>
    <PublicRecentUsagePanel records={records.map((record) => ({
      id: record.id, createdAt: new Date(record.timestamp).toISOString(),
      participant: { id: record.userId, displayName: 'Alexandria Catherine Montgomery', username: 'alexandria', avatarUrl: null, profileColor: null },
      model: { id: record.modelId, name: 'A model with a very long display name', logo: 'openai' },
      inputTokens: record.tokensIn, outputTokens: record.tokensOut, costMicros: record.cost * 1000000,
      inferenceReferenceCostMicros: 0, subscriptionCoveredMicros: 0,
    }))} nextCursor={null} loadingMore={false} onLoadMore={() => undefined} />
    <Section title="General"><TextField label="Public URL" hint="Managed by the PUBLIC_URL deployment setting." value="https://a-long-instance-name.example.test" disabled /></Section>
    <button onClick={() => setOpen(true)}>Open tall dialog</button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent>
      <DialogHeader><DialogTitle>Dialog on a short screen</DialogTitle></DialogHeader>
      <div style={{ height: 700 }}>Tall form content</div>
      <button onClick={() => setOpen(false)}>Finish dialog</button>
    </DialogContent></Dialog>
    <Popover><PopoverTrigger>Open wide popover</PopoverTrigger><PopoverContent style={{ width: 336 }}>Icon picker</PopoverContent></Popover>
  </main></TooltipProvider>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
