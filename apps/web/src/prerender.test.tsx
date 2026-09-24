import { describe, expect, it } from 'vitest'
import { LANDING_TITLE, renderLandingDocument } from './prerender'

const indexHtml = `<!doctype html><html><head><title>Pulpo</title><meta property="og:title" content="Pulpo" /></head><body><div id="root"></div><script type="module" src="/assets/index.js"></script></body></html>`

describe('landing pre-render', () => {
  it('fills the root with the landing page and keeps the app bundle', async () => {
    const html = await renderLandingDocument(indexHtml)
    expect(html).toContain(`<title>${LANDING_TITLE}</title>`)
    expect(html).toContain(`<meta property="og:title" content="${LANDING_TITLE}" />`)
    expect(html).toMatch(/<div id="root">.*<h1[^>]*>Open-source chatbot for everyday use<\/h1>/s)
    expect(html).toContain('href="/login"')
    expect(html).toContain('href="https://help.pulpo.baby"')
    expect(html).toContain('/landing/chat-dark.webp')
    expect(html).toContain('<script type="module" src="/assets/index.js"></script>')
  })

  it('renders deterministically without per-visitor details', async () => {
    const html = await renderLandingDocument(indexHtml)
    expect(html).not.toContain('Download for')
    expect(html).not.toContain('href="/signup"')
    expect(html).toContain("localStorage.getItem('pulpo-profile')")
  })

  it('fails the build when the root placeholder is missing', async () => {
    await expect(renderLandingDocument('<html><body></body></html>')).rejects.toThrow('no <div id="root"></div>')
  })
})
