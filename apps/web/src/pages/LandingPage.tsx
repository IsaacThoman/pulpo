import { Link, Navigate } from 'react-router-dom'
import { BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/useAppTranslation'
import { ui } from '@/i18n/ui'
import { DOCS_URL, GITHUB_URL } from '@/lib/links'
import { useAuth } from '@/stores/auth'

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

function Screenshot({ name, alt, eager = false }: { name: string; alt: string; eager?: boolean }) {
  const loading = eager ? 'eager' : 'lazy'
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-2xl shadow-black/10 dark:shadow-black/40">
      <img src={`/landing/${name}-light.webp`} alt={alt} width={1440} height={900} className="block h-auto w-full dark:hidden" loading={loading} decoding="async" />
      <img src={`/landing/${name}-dark.webp`} alt={alt} width={1440} height={900} className="hidden h-auto w-full dark:block" loading={loading} decoding="async" />
    </div>
  )
}

export function LandingPage() {
  const { t } = useTranslation()
  const instanceName = useAuth((s) => s.instanceName)
  const signupEnabled = useAuth((s) => s.signupEnabled)
  const setupRequired = useAuth((s) => s.setupRequired)

  if (setupRequired) return <Navigate to="/setup" replace />

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
          <Button asChild size="sm">
            <Link to="/login">{ui("Log in")}</Link>
          </Button>
        </nav>
      </header>

      <main>
        <section className="mx-auto flex max-w-3xl flex-col items-center px-4 pt-12 pb-12 text-center sm:px-8 sm:pt-20">
          <img src="/pulpo-smiley.png" alt="" className="size-16 sm:size-20" />
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{ui("Every model, one workspace")}</h1>
          <p className="mt-4 max-w-xl text-base text-pretty text-muted-foreground sm:text-lg">{ui("Pulpo is a configurable, self-hostable AI platform. Chat with models from every major lab, run agents, and keep your history in sync across the web, iOS, and Android.")}</p>
          <div className="mt-8 flex w-full max-w-xs flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row">
            <Button asChild size="lg" className="sm:min-w-32">
              <Link to="/login">{ui("Log in")}</Link>
            </Button>
            {signupEnabled ? (
              <Button asChild size="lg" variant="outline" className="sm:min-w-32">
                <Link to="/signup">{t('auth.signUp')}</Link>
              </Button>
            ) : null}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 sm:px-8">
          <Screenshot eager name="chat" alt={ui("A Pulpo conversation with a formatted answer and code")} />
        </section>

        <section className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-8 md:grid-cols-2 md:gap-8 md:py-24">
          <figure>
            <Screenshot name="agent" alt={ui("Pulpo Agent running Python to answer a question")} />
            <figcaption className="mt-4">
              <h2 className="font-semibold">{ui("Agents that do the work")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{ui("Pulpo Agent runs code in a sandboxed workspace and shows every step it takes.")}</p>
            </figcaption>
          </figure>
          <figure>
            <Screenshot name="table" alt={ui("A comparison table in a Pulpo answer")} />
            <figcaption className="mt-4">
              <h2 className="font-semibold">{ui("Answers that read well")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{ui("Tables, math, and code render cleanly, and every chat stays searchable.")}</p>
            </figcaption>
          </figure>
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
