import { useState } from 'react'
import { CheckCircle2, Download, FlaskConical, Loader2, Upload, XCircle } from 'lucide-react'
import { MODELS } from '@/lib/mock'
import { formatNumber } from '@/lib/format'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { ModelIcon } from '@/components/ModelIcon'
import type { Model } from '@/lib/types'
import { cn } from '@/lib/utils'

type TestStatus = 'idle' | 'testing' | 'pass' | 'fail'

export function ModelsPage() {
  const [prices, setPrices] = useState<Record<string, { in: string; out: string; msg: string }>>(
    () =>
      Object.fromEntries(
        MODELS.map((m) => [
          m.id,
          { in: m.inputPrice.toString(), out: m.outputPrice.toString(), msg: m.perMessagePrice.toString() },
        ])
      )
  )
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(MODELS.map((m) => [m.id, m.enabled]))
  )
  const [testStatus, setTestStatus] = useState<Record<string, TestStatus>>({})
  const [testingAll, setTestingAll] = useState(false)

  const testAll = () => {
    setTestingAll(true)
    const active = MODELS.filter((m) => enabled[m.id])
    active.forEach((m, i) => {
      setTimeout(() => setTestStatus((s) => ({ ...s, [m.id]: 'testing' })), i * 300)
      setTimeout(
        () =>
          setTestStatus((s) => ({
            ...s,
            [m.id]: Math.random() > 0.12 ? 'pass' : 'fail',
          })),
        i * 300 + 900 + Math.random() * 800
      )
    })
    setTimeout(() => setTestingAll(false), active.length * 300 + 2000)
  }

  const priceCell = (m: Model, key: 'in' | 'out' | 'msg', prefix = '$') => (
    <div className="flex items-center justify-end gap-1">
      <span className="text-xs text-muted-foreground">{prefix}</span>
      <Input
        className="h-7 w-20 px-1.5 text-right text-xs tabular-nums"
        value={prices[m.id][key]}
        onChange={(e) =>
          setPrices((p) => ({ ...p, [m.id]: { ...p[m.id], [key]: e.target.value } }))
        }
      />
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">Model pricing</h2>
        <div className="flex-1" />
        <Button variant="outline" size="sm">
          <Upload />
          Import JSON
        </Button>
        <Button variant="outline" size="sm">
          <Download />
          Export JSON
        </Button>
        <Button size="sm" onClick={testAll} disabled={testingAll}>
          {testingAll ? <Loader2 className="animate-spin" /> : <FlaskConical />}
          Test availability
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Prices are USD per 1M tokens. Per-message price is added on top of token cost. Derived
        models inherit base-model prices on sync.
      </p>

      <Card className="shadow-none">
        <CardContent className="px-0 py-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Model</th>
                <th className="py-2.5 text-right font-medium">Context</th>
                <th className="py-2.5 text-right font-medium">Input /1M</th>
                <th className="py-2.5 text-right font-medium">Output /1M</th>
                <th className="py-2.5 text-right font-medium">Per msg</th>
                <th className="py-2.5 text-center font-medium">Status</th>
                <th className="px-5 py-2.5 text-right font-medium">Enabled</th>
              </tr>
            </thead>
            <tbody>
              {MODELS.map((m) => (
                <tr key={m.id} className={cn('border-b last:border-0', !enabled[m.id] && 'opacity-50')}>
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <ModelIcon model={m} className="size-5 rounded-[3px]" />
                      <div>
                        <div className="font-medium">{m.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {m.provider} · {m.id}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 text-right text-xs tabular-nums text-muted-foreground">
                    {formatNumber(m.contextWindow)}
                  </td>
                  <td className="py-2.5">{priceCell(m, 'in')}</td>
                  <td className="py-2.5">{priceCell(m, 'out')}</td>
                  <td className="py-2.5">{priceCell(m, 'msg')}</td>
                  <td className="py-2.5 text-center">
                    {testStatus[m.id] === 'testing' && (
                      <Loader2 className="mx-auto size-4 animate-spin text-muted-foreground" />
                    )}
                    {testStatus[m.id] === 'pass' && (
                      <Badge variant="secondary" className="text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 />
                        pass
                      </Badge>
                    )}
                    {testStatus[m.id] === 'fail' && (
                      <Badge variant="destructive">
                        <XCircle />
                        fail
                      </Badge>
                    )}
                  </td>
                  <td className="px-5 py-2.5 text-right">
                    <Switch
                      checked={enabled[m.id]}
                      onCheckedChange={(v) => setEnabled((e) => ({ ...e, [m.id]: v }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
