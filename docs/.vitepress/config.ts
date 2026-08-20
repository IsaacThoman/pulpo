import { defineConfig } from 'vitepress'

const userSidebar = [
  {
    text: 'Start here',
    items: [
      { text: 'Welcome', link: '/' },
      { text: 'Getting started', link: '/getting-started' },
      { text: 'Pulpo for iPhone', link: '/guides/iphone' },
    ],
  },
]

const operatorSidebar = [
  ...userSidebar,
  {
    text: 'Operate Pulpo',
    items: [
      { text: 'Self-hosting', link: '/self-hosting' },
      { text: 'Management CLI', link: '/operations/cli' },
      { text: 'Billing and licensing', link: '/billing' },
      { text: 'Complete operator reference', link: '/operations/reference' },
    ],
  },
  {
    text: 'Understand Pulpo',
    collapsed: true,
    items: [
      { text: 'Architecture', link: '/concepts/architecture' },
      { text: 'Local-first and realtime', link: '/concepts/realtime' },
      { text: 'OpenAI-compatible API', link: '/api' },
    ],
  },
  {
    text: 'Contribute',
    collapsed: true,
    items: [{ text: 'Development and releases', link: '/contributing' }],
  },
]

export default defineConfig({
  lang: 'en-US',
  title: 'Pulpo Docs',
  titleTemplate: ':title · Pulpo Docs',
  description: 'Guides for using, self-hosting, operating, and integrating with Pulpo.',
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
    nav: [
      {
        text: 'Documentation',
        items: [
          { text: 'Guides', link: '/getting-started' },
          { text: 'Self-hosting', link: '/self-hosting' },
          { text: 'API', link: '/api' },
        ],
      },
    ],
    sidebar: {
      '/getting-started': userSidebar,
      '/guides/': userSidebar,
      '/': operatorSidebar,
    },
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
