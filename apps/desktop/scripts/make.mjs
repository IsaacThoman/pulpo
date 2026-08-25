import { spawn } from 'node:child_process'
import path from 'node:path'

const forge = path.resolve(import.meta.dirname, '../../../node_modules/@electron-forge/cli/dist/electron-forge.js')
const nodeMajor = Number(process.versions.node.split('.')[0])
const forwarded = process.argv.slice(2)

function run(command, args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: path.resolve(import.meta.dirname, '..'),
      env,
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error(`Command stopped with ${signal}.`))
      else resolve(code ?? 1)
    })
  })
}

async function main() {
  if (nodeMajor >= 26 && process.env.PULPO_FORGE_NODE24 !== '1') {
    return run('npx', ['--yes', '--package=node@24.18.1', 'node', import.meta.filename, ...forwarded], {
      ...process.env,
      PULPO_FORGE_NODE24: '1',
    })
  }

  for (const workspace of ['@pulpo/contracts', '@pulpo/client-core']) {
    const buildCode = await run('npm', ['run', 'build', '--workspace', workspace])
    if (buildCode !== 0) return buildCode
  }

  const rebuildCode = await run('npm', ['rebuild', 'macos-alias', 'fs-xattr'])
  if (rebuildCode !== 0) return rebuildCode

  return run(process.execPath, [forge, 'make', ...forwarded])
}

main().then((code) => {
  process.exitCode = code
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
