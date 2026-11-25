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
      <header className="sticky top-0 z-50 border-b bg-background">
        <div className="mx-auto flex min-h-14 max-w-6xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-8">
          <Link to="/" className="flex min-w-0 items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-ring">
            <img src="/pulpo-smiley.png" alt="" className="size-8 shrink-0" />
            <span className="truncate text-base font-semibold max-[379px]:sr-only">{instanceName}</span>
          </Link>
          <nav className="flex min-w-0 flex-wrap items-center justify-end gap-x-0.5 py-1 sm:gap-x-2">
            {/* Icon-only on phones; the label stays available to screen readers, and the star count waits for room. */}
            <Button asChild variant="ghost" size="sm" className="max-sm:has-[>svg]:px-2">
              <a href={DOCS_URL}><BookOpen strokeWidth={1.5} /><span className="sr-only sm:not-sr-only">{ui("Docs")}</span></a>
            </Button>
            <Button asChild variant="ghost" size="sm" className="max-sm:has-[>svg]:px-2">
              <a href={GITHUB_URL}><GithubIcon /><span className="sr-only sm:not-sr-only">{ui("GitHub")}</span><GithubStars className="hidden text-muted-foreground sm:inline-flex" /></a>
            </Button>
            {signupEnabled ? (
              <Button asChild variant="ghost" size="sm" className="max-sm:px-2">
                <Link to="/signup">{t('auth.signUp')}</Link>
              </Button>
            ) : null}
            <Button asChild size="sm" className="max-sm:px-2">
              <Link to="/login">{ui("Log in")}</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pt-12 pb-6 sm:px-8 lg:pt-20 lg:pb-10">
          <div className="grid items-end gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)] lg:gap-12">
            <h1 className="max-w-xl text-4xl leading-[1.08] font-medium tracking-tight text-pretty sm:text-5xl lg:text-[3.5rem]">{ui("Self-hosted chatbot for everyday use")}</h1>
            <div>
              <p className="max-w-lg text-base leading-6 text-pretty text-muted-foreground sm:text-lg sm:leading-7">{ui("Use your choice of models and give agents a fresh workspace for each task. Your chats and drafts sync between the browser and the native apps.")}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <DownloadButton className="h-11 rounded-lg shadow-none max-sm:has-[>svg]:px-3" />
                <Button asChild size="lg" variant="ghost" className="h-11 rounded-lg border max-sm:has-[>svg]:px-3">
                  <Link to="/login"><LaptopMinimal strokeWidth={1.5} />{ui("Open in browser")}</Link>
                </Button>
              </div>
            </div>
          </div>
          <div className="mt-8 sm:mt-10">
            <HeroDemo />
          </div>
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
              <DownloadButton className="h-11 rounded-lg shadow-none" />
              <Button asChild size="lg" variant="ghost" className="h-11 rounded-lg border">
                <Link to="/login"><LaptopMinimal strokeWidth={1.5} />{ui("Open in browser")}</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
