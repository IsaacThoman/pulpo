import { chmod, readFile } from 'node:fs/promises'
import { build } from 'esbuild'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const version = process.env.PULPO_CLI_VERSION || packageJson.version

await build({
  entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  outfile: new URL('../dist/index.js', import.meta.url).pathname,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  external: ['commander', 'socket.io-client'],
  // Bundled CommonJS dependencies (tar-stream) require Node builtins at runtime.
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __pulpoCreateRequire } from 'node:module'\nconst require = __pulpoCreateRequire(import.meta.url)" },
  define: { __PULPO_CLI_VERSION__: JSON.stringify(version), __PULPO_CLI_BUNDLED__: 'true' },
})
await chmod(new URL('../dist/index.js', import.meta.url), 0o755)
