import { describe, expect, it } from 'vitest'
import { helpText, parseCli, UsageError } from './cli-args.js'

const usageError = (argv: string[]) => {
  try { parseCli(argv) } catch (error) { if (error instanceof UsageError) return error }
  throw new Error(`expected a usage error for ${argv.join(' ')}`)
}

describe('pulpo files argument parsing', () => {
  it('parses every command with its options', () => {
    expect(parseCli(['files', 'ls'])).toEqual({ command: 'ls', path: undefined, recursive: false })
    expect(parseCli(['files', 'ls', 'Projects', '-R'])).toEqual({ command: 'ls', path: 'Projects', recursive: true })
    expect(parseCli(['files', 'tree', '--depth', '2'])).toEqual({ command: 'tree', path: undefined, depth: 2 })
    expect(parseCli(['files', 'tree', 'Projects', '-L3'])).toEqual({ command: 'tree', path: 'Projects', depth: 3 })
    expect(parseCli(['files', 'tree', '--depth=8'])).toEqual({ command: 'tree', path: undefined, depth: 8 })
    expect(parseCli(['files', 'cat', 'a.md', 'b.md'])).toEqual({ command: 'cat', paths: ['a.md', 'b.md'] })
    expect(parseCli(['files', 'grep', '-iF', 'a.b', 'Projects'])).toEqual({ command: 'grep', pattern: 'a.b', path: 'Projects', ignoreCase: true, fixed: true })
    expect(parseCli(['files', 'grep', '-rn', '--', '-x'])).toEqual({ command: 'grep', pattern: '-x', path: undefined, ignoreCase: false, fixed: false })
    expect(parseCli(['files', 'pull', 'Projects', '/tmp/p'])).toEqual({ command: 'pull', path: 'Projects', dest: '/tmp/p' })
    expect(parseCli(['files', 'status'])).toEqual({ command: 'status' })
    expect(parseCli(['files', 'push'])).toEqual({ command: 'push', locals: [], to: undefined, force: false })
    expect(parseCli(['files', 'push', 'a.pdf', '--to', 'Projects/', '-f'])).toEqual({ command: 'push', locals: ['a.pdf'], to: 'Projects/', force: true })
    expect(parseCli(['files', 'mkdir', '-p', 'A/B', 'C'])).toEqual({ command: 'mkdir', paths: ['A/B', 'C'], parents: true })
    expect(parseCli(['files', 'mv', 'a', 'b'])).toEqual({ command: 'mv', from: 'a', to: 'b' })
    expect(parseCli(['files', 'rm', '-rf', 'Old'])).toEqual({ command: 'rm', paths: ['Old'], recursive: true })
  })

  it('answers help requests at every level', () => {
    expect(parseCli(['--help'])).toEqual({ command: 'help' })
    expect(parseCli(['files', '--help'])).toEqual({ command: 'help', topic: undefined })
    expect(parseCli(['files', 'help', 'push'])).toEqual({ command: 'help', topic: 'push' })
    expect(parseCli(['files', 'push', '--help'])).toEqual({ command: 'help', topic: 'push' })
    expect(parseCli(['files', 'grep', 'x', '-h'])).toEqual({ command: 'help', topic: 'grep' })
    expect(helpText()).toContain('pulpo files pull Projects/Plan.md')
    expect(helpText('push')).toContain('--force')
  })

  it('reports usage errors with the command they belong to', () => {
    expect(usageError([]).topLevel).toBe(true)
    expect(usageError(['git', 'status']).message).toContain('Only `pulpo files <command>`')
    expect(usageError(['files', 'download', 'x']).message).toContain('Did you mean `pulpo files pull`?')
    expect(usageError(['files', 'grep', '-x', 'y'])).toMatchObject({ command: 'grep', message: expect.stringContaining('unknown option -x') })
    expect(usageError(['files', 'tree', '--depth', '0']).message).toContain('from 1 to 8')
    expect(usageError(['files', 'mv', 'a']).message).toBe('expected <from> <to>, got "a".')
    expect(usageError(['files', 'status', 'x']).command).toBe('status')
    expect(usageError(['files', 'cat']).message).toBe('expected <path>..., got nothing.')
    expect(usageError(['files', 'push', '--to']).command).toBe('push')
    expect(usageError(['files', 'grep', '']).message).toContain('empty')
  })
})
