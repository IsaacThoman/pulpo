import type { SearchLinkedPanel } from '@pulpo/contracts/search'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { ui } from '@/i18n/ui'

function searchPanelUrl(searchUrl: string, panel?: SearchLinkedPanel): string {
  const url = new URL('/', searchUrl)
  if (panel) url.hash = panel
  return url.href
}

function SearchLink({ href, children, variant = 'outline' }: {
  href: string
  children: React.ReactNode
  variant?: 'default' | 'outline'
}) {
  return (
    <Button asChild variant={variant} size="sm" className="shrink-0">
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
        <ExternalLink aria-hidden />
      </a>
    </Button>
  )
}

function SearchRow({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  )
}

export function SearchSettings({ searchUrl }: { searchUrl: string }) {
  return (
    <div>
      <h2 className="text-base font-semibold">{ui('Pulpo Search')}</h2>
      <Separator className="my-3" />
      <div className="flex flex-col gap-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <p className="text-sm text-muted-foreground">
          {ui('Search the web with your Pulpo account. Your theme, profile picture, and credits carry over, and Search preferences sync wherever you sign in.')}
        </p>
        <SearchLink href={searchPanelUrl(searchUrl)} variant="default">{ui('Open Pulpo Search')}</SearchLink>
      </div>
      <Separator className="my-2" />
      <div className="divide-y">
        <SearchRow title={ui('Search preferences')} hint={ui('Providers, safe search, region, results per page, and site rules.')}>
          <SearchLink href={searchPanelUrl(searchUrl, 'settings')}>{ui('Edit preferences')}</SearchLink>
        </SearchRow>
        <SearchRow title={ui('Bangs')} hint={ui('Shortcuts like !w that send a search straight to another site.')}>
          <SearchLink href={searchPanelUrl(searchUrl, 'bangs')}>{ui('Manage bangs')}</SearchLink>
        </SearchRow>
        <SearchRow title={ui('Add to browser')} hint={ui('Make Pulpo Search the default search engine in your browser.')}>
          <SearchLink href={searchPanelUrl(searchUrl, 'browser')}>{ui('Set up')}</SearchLink>
        </SearchRow>
      </div>
    </div>
  )
}
