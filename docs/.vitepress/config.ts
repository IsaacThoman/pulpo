import { defineConfig } from 'vitepress'

const sidebar = [
  {
    text: 'Pulpo Docs',
    items: [
      { text: 'Welcome', link: '/' },
      { text: 'Self-hosting', link: '/self-hosting' },
    ],
  },
  {
    text: 'Legal',
    items: [
      { text: 'Software privacy policy', link: '/privacy' },
      { text: 'Hosted service privacy policy', link: '/privacy-hosted' },
    ],
  },
]

export default defineConfig({
  lang: 'en-US',
  title: 'Pulpo Docs',
  titleTemplate: ':title · Pulpo Docs',
  description: 'Pulpo is a configurable self-hostable AI platform for the web and iOS.',
  base: '/',
  cleanUrls: true,
  lastUpdated: true,
  sitemap: {
    hostname: 'https://help.pulpo.baby',
  },
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/pulpo-smiley.png' }],
    ['link', { rel: 'apple-touch-icon', href: '/pulpo-app-icon.png' }],
    ['meta', { name: 'theme-color', content: '#7c3aed' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Pulpo Docs' }],
    ['meta', { property: 'og:image', content: 'https://help.pulpo.baby/pulpo-app-icon.png' }],
  ],
  themeConfig: {
    logo: '/pulpo-smiley.png',
    siteTitle: 'Pulpo Docs',
    sidebar,
    search: {
      provider: 'local',
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/IsaacThoman/pulpo' }],
    editLink: {
      pattern: 'https://github.com/IsaacThoman/pulpo/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
    footer: {
      message: 'Pulpo documentation is open source.',
      copyright: 'Pulpo',
    },
    outline: { level: [2, 3] },
  },
  vite: {
    publicDir: '../apps/mobile/assets',
  },
})
