import type { ChatThreadStatus } from '@pulpo/contracts'
import { CircleAlert, CircleCheck, CircleCheckBig, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/** The icon beside a thread's status. */
export function ThreadStatusIcon({ status, className }: { status: ChatThreadStatus; className?: string }) {
  switch (status) {
    case 'working': return <Loader2 aria-hidden className={cn('animate-spin text-muted-foreground', className)} />
    case 'attention': return <CircleAlert aria-hidden className={cn('text-amber-600 dark:text-amber-400', className)} />
    case 'done': return <CircleCheck aria-hidden className={cn('text-emerald-600 dark:text-emerald-400', className)} />
    case 'resolved': return <CircleCheckBig aria-hidden className={cn('text-muted-foreground', className)} />
  }
}
