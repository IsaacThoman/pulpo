import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { LANDING_DESCRIPTION, LANDING_TITLE, LANDING_URL, renderLandingDocument } from './prerender'

const indexHtml = `<!doctype html><html><head><title>Pulpo</title><meta property="og:title" content="Pulpo" /></head><body><div id="root"></div><script type="module" src="/assets/index.js"></script></body></html>`

describe('landing pre-render', () => {
  it('fills the root with the landing page and keeps the app bundle', async () => {
    const html = await renderLandingDocument(indexHtml)
    expect(html).toContain(`<title>${LANDING_TITLE}</title>`)
    expect(html).toContain(`<meta property="og:title" content="${LANDING_TITLE}" />`)
    expect(html).toMatch(/<div id="root">.*<h1[^>]*>Self-hosted chatbot for everyday use<\/h1>/s)
    expect(html).toContain('href="/login"')
    expect(html).toContain('href="https://help.pulpo.baby"')
    expect(html).toContain('landing-device-canvas')
    expect(html).toContain('<script type="module" src="/assets/index.js"></script>')
  })

  it('renders deterministically without per-visitor details', async () => {
    const html = await renderLandingDocument(indexHtml)
    expect(html).not.toContain('Download for')
    expect(html).toContain('href="https://github.com/IsaacThoman/pulpo/releases/latest"')
    expect(html).not.toContain('href="/signup"')
    expect(html).toContain("localStorage.getItem('pulpo-profile')")
    expect(html).toMatch(/<script>[^<]*prefers-color-scheme: dark[^<]*<\/script>.*<\/head>/s)
  })

  it('adds Organization, WebSite, and SoftwareApplication structured data', async () => {
    const html = await renderLandingDocument(indexHtml)
    const json = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)?.[1]
    const graph: Array<Record<string, unknown>> = JSON.parse(json ?? 'null')['@graph']
    expect(graph.map((node) => node['@type'])).toEqual(['Organization', 'WebSite', 'SoftwareApplication'])
    expect(graph[2]).toMatchObject({
      name: 'Pulpo',
      url: LANDING_URL,
      description: LANDING_DESCRIPTION,
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0' },
    })
  })

  it('points search engines at pulpo.baby', async () => {
    const html = await renderLandingDocument(indexHtml)
    expect(html).toContain(`<link rel="canonical" href="${LANDING_URL}" />`)
    expect(html).toContain(`<meta property="og:url" content="${LANDING_URL}" />`)
  })

  it('matches the description in index.html', () => {
    const source = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    expect(source).toContain(`<meta name="description" content="${LANDING_DESCRIPTION}" />`)
    expect(source).toContain(`<meta property="og:description" content="${LANDING_DESCRIPTION}" />`)
  })

  it('fails the build when the root placeholder is missing', async () => {
    await expect(renderLandingDocument('<html><body></body></html>')).rejects.toThrow('no <div id="root"></div>')
  })
})
