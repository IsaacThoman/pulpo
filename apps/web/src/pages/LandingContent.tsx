import { Link } from 'react-router-dom'
import { BookOpen, LaptopMinimal } from 'lucide-react'
import { DownloadButton } from '@/components/DownloadButton'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/useAppTranslation'
import { ui } from '@/i18n/ui'
import { DOCS_URL, GITHUB_URL } from '@/lib/links'

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

function Screenshot({ name, alt }: { name: string; alt: string }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-2xl shadow-black/10 dark:shadow-black/40">
      <img src={`/landing/${name}-light.webp`} alt={alt} width={1440} height={900} className="block h-auto w-full dark:hidden" decoding="async" />
      <img src={`/landing/${name}-dark.webp`} alt={alt} width={1440} height={900} className="hidden h-auto w-full dark:block" decoding="async" />
    </div>
  )
}

/** The signed-out landing page. Free of runtime stores so the build can pre-render it (see scripts/prerender-landing.mjs). */
export function LandingContent({ instanceName, signupEnabled }: { instanceName: string; signupEnabled: boolean }) {
  const { t } = useTranslation()

  return (
    <div className="min-h-dvh overflow-x-hidden bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-8">
        <Link to="/" className="flex min-w-0 items-center gap-2.5">
          <img src="/pulpo-smiley.png" alt="" className="size-8" />
          <span className="truncate text-lg font-semibold tracking-tight">{instanceName}</span>
        </Link>
        <nav className="flex shrink-0 items-center gap-1 sm:gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <a href={DOCS_URL}><BookOpen />{ui("Docs")}</a>
          </Button>
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <a href={GITHUB_URL}><GithubIcon />{ui("GitHub")}</a>
          </Button>
          {signupEnabled ? (
            <Button asChild variant="outline" size="sm">
              <Link to="/signup">{t('auth.signUp')}</Link>
            </Button>
          ) : null}
          <Button asChild size="sm">
            <Link to="/login">{ui("Log in")}</Link>
          </Button>
        </nav>
      </header>

      <main>
        <section className="mx-auto flex max-w-5xl flex-col items-center px-4 pt-12 pb-10 text-center sm:px-8 sm:pt-16 sm:pb-12">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{ui("Open-source chatbot for everyday use")}</h1>
          <p className="mt-4 text-base text-pretty text-muted-foreground sm:text-lg">{ui("Pulpo comes with native mobile apps, fast disposable workspaces, and broad model support. Everything stays perfectly in sync.")}</p>
          <div className="mt-8 flex w-full max-w-xs flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row">
            <DownloadButton />
            <Button asChild size="lg" variant="outline">
              <Link to="/login"><LaptopMinimal />{ui("Open in your browser")}</Link>
            </Button>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-8 md:pb-24">
          <Screenshot name="chat" alt={ui("A Pulpo conversation with a formatted answer and code")} />
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted-foreground sm:px-8">
          <a href={DOCS_URL} className="hover:text-foreground">{ui("Docs")}</a>
          <a href={`${DOCS_URL}/privacy`} className="hover:text-foreground">{ui("Privacy")}</a>
          <a href={`${DOCS_URL}/support`} className="hover:text-foreground">{ui("Support")}</a>
          <a href={GITHUB_URL} className="hover:text-foreground">{ui("GitHub")}</a>
        </div>
      </footer>
    </div>
  )
}
