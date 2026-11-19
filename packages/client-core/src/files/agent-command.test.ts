import { describe, expect, it } from 'vitest'
import { agentPathName, pulpoCliCommand, pulpoComputerCommand, pulpoFilesCommand, shellWords } from './agent-command.js'

describe('shellWords', () => {
  it('honours quotes and escapes', () => {
    expect(shellWords(`pulpo computer cat "My Notes/a b.md" 'c d' e\\ f`)).toEqual(['pulpo', 'computer', 'cat', 'My Notes/a b.md', 'c d', 'e f'])
  })
})

describe('pulpoCliCommand', () => {
  it('reads the group, the subcommand and its first path, skipping options and their values', () => {
    expect(pulpoCliCommand('pulpo files push --to "My Reports/q3.pdf" ./q3.pdf')).toEqual({ group: 'files', subcommand: 'push', path: './q3.pdf' })
    expect(pulpoCliCommand('cd /workspace/computer && pulpo computer pull src/app.ts')).toEqual({ group: 'computer', subcommand: 'pull', path: 'src/app.ts' })
    expect(pulpoCliCommand('/usr/local/bin/pulpo computer tree --depth 2 src')).toEqual({ group: 'computer', subcommand: 'tree', path: 'src' })
    expect(pulpoCliCommand('pulpo computer --help')).toEqual({ group: 'computer', subcommand: 'help', path: undefined })
  })

  it('keeps several commands of one group, labelled by the first', () => {
    expect(pulpoCliCommand('pulpo computer pull a.md && pulpo computer pull b.md')).toEqual({ group: 'computer', subcommand: 'pull', path: 'a.md' })
  })

  it.each([
    'pulpo computer pull a.md && pulpo files push a.md',
    'pulpo computer pull a.md && python3 x.py',
    'echo pulpo computer ls',
    'pulpo computers ls',
    'pulpo ls',
  ])('ignores %s', (command) => {
    expect(pulpoCliCommand(command)).toBeNull()
  })
})

describe('group helpers', () => {
  it('answer only for their own group', () => {
    expect(pulpoFilesCommand('pulpo files cat Plan.md')).toEqual({ subcommand: 'cat', path: 'Plan.md' })
    expect(pulpoFilesCommand('pulpo computer cat Plan.md')).toBeNull()
    expect(pulpoComputerCommand('pulpo computer rm -r old/')).toEqual({ subcommand: 'rm', path: 'old/' })
    expect(pulpoComputerCommand('pulpo files rm old/')).toBeNull()
  })
})

describe('agentPathName', () => {
  it('keeps the last segment', () => {
    expect(agentPathName('a/b/c.md')).toBe('c.md')
    expect(agentPathName('Old drafts/')).toBe('Old drafts')
  })
})
