import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import i18n from '@/i18n'
import { APP_STORE_URL, GITHUB_LATEST_RELEASE_URL, GITHUB_URL } from '@/lib/links'
import { LandingContent } from '@/pages/LandingContent'

export const LANDING_TITLE = 'Pulpo'
/** Also the meta and Open Graph description in index.html, which a test keeps in step. */
export const LANDING_DESCRIPTION = 'Open-source, self-hosted AI chat for any model, with native iPhone and Android apps, instant agent workspaces, and chats that stay in sync everywhere.'
export const LANDING_URL = 'https://pulpo.baby/'
const EMPTY_ROOT = '<div id="root"></div>'

// Self-hosted instances serve this same page, so the canonical URL keeps search results on pulpo.baby.
const CANONICAL = `<link rel="canonical" href="${LANDING_URL}" /><meta property="og:url" content="${LANDING_URL}" />`

// Structured data for search results: the site, who publishes it, and the app itself.
const ORGANIZATION_ID = `${LANDING_URL}#organization`
const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': ORGANIZATION_ID,
      name: 'Pulpo',
      url: LANDING_URL,
      logo: `${LANDING_URL}pulpo-smiley.png`,
      sameAs: [GITHUB_URL, APP_STORE_URL],
    },
    {
      '@type': 'WebSite',
      '@id': `${LANDING_URL}#website`,
      name: 'Pulpo',
      url: LANDING_URL,
      publisher: { '@id': ORGANIZATION_ID },
    },
    {
      '@type': 'SoftwareApplication',
      name: 'Pulpo',
      url: LANDING_URL,
      description: LANDING_DESCRIPTION,
      applicationCategory: 'ProductivityApplication',
      operatingSystem: 'Web, macOS, Windows, Android, iOS',
      image: `${LANDING_URL}og-image.jpg`,
      downloadUrl: GITHUB_LATEST_RELEASE_URL,
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      publisher: { '@id': ORGANIZATION_ID },
      sameAs: [GITHUB_URL, APP_STORE_URL],
    },
  ],
}

// Applies the system theme before first paint so dark-mode visitors never see the light page flash.
// Signed-in visitors are left to the app, which applies their saved theme.
const SYSTEM_THEME = `<script>try{if(!localStorage.getItem('pulpo-profile')&&matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')}catch(e){}</script>`

// Signed-in visitors should not see the landing page flash before the app mounts, so the
// pre-rendered markup is dropped when the auth store's cached profile is present.
const SIGNED_IN_GUARD = `<script>try{if(localStorage.getItem('pulpo-profile'))document.getElementById('root').replaceChildren()}catch(e){}</script>`

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Renders the signed-out landing page into the built index.html so crawlers and link previews get real content at `/`. */
export async function renderLandingDocument(indexHtml: string): Promise<string> {
  await i18n.changeLanguage('en-US')
  // Sign-up availability is per instance and only known at runtime, so the static page omits it.
  const markup = renderToStaticMarkup(<MemoryRouter><LandingContent instanceName="Pulpo" signupEnabled={false} /></MemoryRouter>)
  if (!markup.includes('<h1')) throw new Error('Landing pre-render produced no headline')
  if (!indexHtml.includes(EMPTY_ROOT)) throw new Error(`Built index.html has no ${EMPTY_ROOT}`)
  const title = escapeHtml(LANDING_TITLE)
  return indexHtml
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${title}" />`)
    .replace('</head>', `${CANONICAL}${SYSTEM_THEME}<script type="application/ld+json">${JSON.stringify(STRUCTURED_DATA).replace(/</g, '\\u003c')}</script></head>`)
    .replace(EMPTY_ROOT, `<div id="root">${markup}</div>${SIGNED_IN_GUARD}`)
}
