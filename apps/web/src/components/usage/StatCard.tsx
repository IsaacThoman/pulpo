import type { ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function StatCard({
  label,
  value,
  sub,
  icon,
  className,
}: {
  label: string
  value: string
  sub?: string
  icon?: ReactNode
  className?: string
}) {
  return (
    <Card className={cn('gap-0 py-4 shadow-none', className)}>
      <CardContent className="px-4">
        <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
          {label}
          {icon}
        </div>
        <div className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</div>
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  )
}
