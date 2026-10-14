// `pulpo` inside the workspace (/usr/local/bin/pulpo runs this). Never read stdin: in agent bash
// commands it is a pipe that never closes.
import { defaultContext, runCli } from './cli-main.js'

runCli(process.argv.slice(2), defaultContext()).then((code) => { process.exitCode = code }, (error: unknown) => {
  process.stderr.write(`pulpo: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
