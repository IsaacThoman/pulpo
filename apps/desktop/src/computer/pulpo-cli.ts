/**
 * Build entry for `pulpo-cli.cjs`: the workspace daemon's `pulpo` CLI, bundled into one CommonJS
 * file that the launchers in launcher.ts run with the app's executable as Node. Importing it runs it.
 */
import '../../../../packages/workspace-daemon/src/cli'
