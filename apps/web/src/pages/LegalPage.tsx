import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ui } from '@/i18n/ui'

export function LegalPage({ title, updated, children }: { title: string; updated?: string; children: ReactNode }) {
  return <main className="min-h-dvh bg-background px-5 py-12 text-foreground sm:px-8">
    <article className="mx-auto max-w-2xl">
      <Link to="/" className="inline-flex items-center gap-3 text-lg font-semibold tracking-tight">
        <img src="/pulpo-smiley.png" alt="" className="size-9" /> Pulpo
      </Link>
      <h1 className="mt-12 text-4xl font-semibold tracking-tight">{title}</h1>
      {updated ? <p className="mt-2 text-sm text-muted-foreground">{ui("Last updated")} {updated}</p> : null}
      <div className="mt-8 space-y-7 text-[15px] leading-7 text-muted-foreground [&_a]:text-foreground [&_a]:underline [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6">
        {children}
      </div>
    </article>
  </main>
}
