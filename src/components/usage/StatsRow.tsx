import { Info } from 'lucide-react'
import { formatUsd } from '@/lib/format'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

/** Flat divide-x stat strip: calls, tokens, spend, avg/call, water — no cards. */
export function StatsRow({ calls, tokens, cost }: { calls: number; tokens: number; cost: number }) {
  const stats = [
    { label: 'Calls', value: calls.toLocaleString() },
    { label: 'Tokens', value: tokens.toLocaleString() },
    { label: 'Spend', value: formatUsd(cost) },
    { label: 'Avg per call', value: formatUsd(calls > 0 ? cost / calls : 0) },
    {
      label: 'Water use',
      value: `${(cost / 23.04).toFixed(4)} Gal`,
      info: "Based on Altman's estimate where a query uses 1/15 tsp of water & assumes typical prompt cost ~$0.002 (common medical question to gpt-5 mini in flex mode)",
    },
  ]
  return (
    <div className="grid grid-cols-2 gap-1 sm:grid-cols-5 md:gap-0 md:divide-x">
      {stats.map((s) => (
        <div key={s.label} className="p-3 md:first:pl-0 md:last:pr-0">
          <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
            {s.label}
            {s.info && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="size-3 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="max-w-[300px]">{s.info}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          <div className="text-lg font-medium">{s.value}</div>
        </div>
      ))}
    </div>
  )
}
