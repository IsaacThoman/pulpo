import { spawn } from 'node:child_process'
import path from 'node:path'

const forge = path.resolve(import.meta.dirname, '../../../node_modules/@electron-forge/cli/dist/electron-forge.js')
const nodeMajor = Number(process.versions.node.split('.')[0])
const command = nodeMajor >= 26 ? 'npx' : process.execPath
const args = nodeMajor >= 26
  ? ['--yes', '--package=node@24.18.1', 'node', forge, 'package']
  : [forge, 'package']

const child = spawn(command, args, { cwd: path.resolve(import.meta.dirname, '..'), stdio: 'inherit' })
child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Electron Forge stopped with ${signal}.`)
    process.exitCode = 1
  } else {
    process.exitCode = code ?? 1
  }
})
