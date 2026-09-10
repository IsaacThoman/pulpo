import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getConfig } from '@electron-forge/plugin-vite/dist/config/vite.renderer.config.js'
import { build, mergeConfig } from 'vite'
import { expect, it } from 'vitest'
import rendererConfig from '../vite.renderer.config.mjs'

it('loads built renderer assets from the desktop origin after a nested-route reload', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pulpo-renderer-build-'))
  try {
    await writeFile(path.join(root, 'index.html'), '<div id="root"></div><script type="module" src="/entry.js"></script>')
    await writeFile(path.join(root, 'entry.js'), 'import "./style.css"; document.getElementById("root").textContent = "Pulpo"')
    await writeFile(path.join(root, 'style.css'), 'body { color: red }')
    const config = getConfig({ root, mode: 'production', forgeConfigSelf: { name: 'main_window' } }, rendererConfig)
    const result = await build(mergeConfig(config, {
      configFile: false,
      publicDir: false,
      logLevel: 'silent',
      build: { write: false },
    }))
    const output = (Array.isArray(result) ? result[0] : result).output
    const html = output.find((asset) => asset.fileName === 'index.html').source.toString()
    const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1])
    expect(assets.some((asset) => asset.endsWith('.js'))).toBe(true)
    expect(assets.some((asset) => asset.endsWith('.css'))).toBe(true)
    for (const route of ['/', '/login', '/c/reload-test', '/usage/friends', '/admin/usage/requests', '/c/reload-test/']) {
      for (const asset of assets) {
        const url = new URL(asset, `https://desktop.pulpo.invalid${route}`)
        expect(url.pathname, `${route}: ${asset}`).toMatch(/^\/assets\//)
        expect(output.some((file) => file.fileName === url.pathname.slice(1))).toBe(true)
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
