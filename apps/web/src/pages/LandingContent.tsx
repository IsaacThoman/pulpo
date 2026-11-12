import { Link } from 'react-router-dom'
import { BookOpen, LaptopMinimal } from 'lucide-react'
import { DownloadButton } from '@/components/DownloadButton'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/i18n/useAppTranslation'
import { ui, uit } from '@/i18n/ui'
import { DOCS_URL, GITHUB_URL } from '@/lib/links'
import { GithubIcon } from './landing/GithubIcon'
import { GithubStars } from './landing/GithubStars'
import { HeroDemo } from './landing/demo/HeroDemo'
import { AppsSection, ModelsSection, MoreSection, SelfHostSection, WorkspacesSection } from './landing/sections'

/** The signed-out landing page. Free of runtime stores so the build can pre-render it (see scripts/prerender-landing.mjs). */
export function LandingContent({ instanceName, signupEnabled }: { instanceName: string; signupEnabled: boolean }) {
  const { t } = useTranslation()

  return (
    <div className="min-h-dvh overflow-x-clip bg-background text-foreground">
      <div className="sticky top-0 z-50 bg-background/85 backdrop-blur-md">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-8">
        <Link to="/" className="flex min-w-0 items-center gap-2.5">
          <img src="/pulpo-smiley.png" alt="" className="size-8" />
          <span className="truncate text-lg font-semibold tracking-tight max-[379px]:sr-only">{instanceName}</span>
        </Link>
        <nav className="flex shrink-0 items-center gap-1 sm:gap-2">
          {/* Icon-only on phones; the label stays available to screen readers, and the star count waits for room. */}
          <Button asChild variant="ghost" size="sm">
            <a href={DOCS_URL}><BookOpen /><span className="sr-only sm:not-sr-only">{ui("Docs")}</span></a>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <a href={GITHUB_URL}><GithubIcon /><span className="sr-only sm:not-sr-only">{ui("GitHub")}</span><GithubStars className="hidden text-muted-foreground sm:inline-flex" /></a>
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
      </div>

      <main>
        <section className="mx-auto flex max-w-5xl flex-col items-center px-4 pt-12 pb-10 text-center sm:px-8 sm:pt-16 sm:pb-12">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{ui("Self-hosted chatbot for everyday use")}</h1>
          <p className="mt-4 text-base text-pretty text-muted-foreground sm:text-lg">{ui("Pulpo comes with native mobile apps, fast disposable workspaces, and broad model support. Everything stays perfectly in sync.")}</p>
          <div className="mt-8 flex w-full max-w-xs flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row">
            <DownloadButton />
            <Button asChild size="lg" variant="outline">
              <Link to="/login"><LaptopMinimal />{ui("Open in your browser")}</Link>
            </Button>
          </div>
        </section>

        <section className="px-4 pb-6 sm:px-8 md:pb-8">
          <HeroDemo />
        </section>

        <ModelsSection />
        <WorkspacesSection />
        <AppsSection />
        <MoreSection />
        <SelfHostSection />

        <section>
          <div className="mx-auto flex max-w-3xl flex-col items-center px-4 pt-12 pb-16 text-center sm:px-8 md:pt-16 md:pb-24">
            <img src="/pulpo-smiley.png" alt="" className="size-14" loading="lazy" />
            <h2 className="mt-6 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{uit`Start using ${instanceName}`}</h2>
            <p className="mt-4 text-base text-pretty text-muted-foreground sm:text-lg">{ui("Download the app for your device, or open it in the browser you already have.")}</p>
            <div className="mt-8 flex w-full max-w-xs flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row">
              <DownloadButton />
              <Button asChild size="lg" variant="outline">
                <Link to="/login"><LaptopMinimal />{ui("Open in your browser")}</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
