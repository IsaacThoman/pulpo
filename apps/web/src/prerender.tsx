import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import i18n from '@/i18n'
import { LandingContent } from '@/pages/LandingContent'

export const LANDING_TITLE = 'Pulpo — Open-source chatbot for everyday use'
const EMPTY_ROOT = '<div id="root"></div>'

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
    .replace(EMPTY_ROOT, `<div id="root">${markup}</div>${SIGNED_IN_GUARD}`)
}
