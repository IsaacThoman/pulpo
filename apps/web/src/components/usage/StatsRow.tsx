import { Info } from 'lucide-react'
import { formatUsd } from '@/lib/format'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { activeLocale, ui } from '@/i18n/ui'

/** Flat divide-x stat strip: calls, tokens, spend, avg/call, estimated water — no cards. */
export function StatsRow({ calls, tokens, cost, inferenceReferenceCost = 0 }: {
  calls: number
  tokens: number
  cost: number
  inferenceReferenceCost?: number
}) {
  const stats = [
    { label: ui("Calls"), value: calls.toLocaleString(activeLocale()) },
    { label: ui("Tokens"), value: tokens.toLocaleString(activeLocale()) },
    { label: ui("Spend"), value: formatUsd(cost) },
    ...(inferenceReferenceCost > 0 ? [{
      label: ui("API equivalent"),
      value: formatUsd(inferenceReferenceCost),
      info: ui("Estimated API-equivalent inference value; not charged by Pulpo"),
    }] : []),
    { label: ui("Avg per call"), value: formatUsd(calls > 0 ? cost / calls : 0) },
    {
      label: ui("Estimated water"),
      value: `${(cost / 23.04).toFixed(4)} Gal`,
      info: 'A rough spend-based estimate for comparison only. Actual water use varies by model, datacenter, workload, and energy mix.',
    },
  ]
  return (
    <div className={`grid grid-cols-2 gap-1 ${inferenceReferenceCost > 0 ? 'sm:grid-cols-3 md:grid-cols-6' : 'sm:grid-cols-5'} md:gap-0 md:divide-x`}>
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
