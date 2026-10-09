import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { generateNotes } from '@semantic-release/release-notes-generator'

// Resolve Handlebars from the changelog writer that consumes it.
const handlebars = createRequire(import.meta.resolve('conventional-changelog-writer'))('handlebars')

test('release-note Handlebars rejects injected Program.blockParams in compile and precompile', () => {
  const ast = handlebars.parse('{{#if ready}}ok{{/if}}')
  ast.body[0].program.blockParams = {
    length: '(()=>{throw new Error("injected code executed")})()',
  }

  // compile is lazy: render to ensure validation actually runs.
  assert.throws(() => handlebars.compile(ast)({ ready: true }), /Invalid AST: Program blockParams must be an array/)
  assert.throws(() => handlebars.precompile(ast), /Invalid AST: Program blockParams must be an array/)
})

test('release-note Handlebars denies a prototype own constructor even with prototype methods allowed', () => {
  const instance = handlebars.create()
  let inspected = false
  instance.registerHelper('prototype', () => Function.prototype)
  instance.registerHelper('inspect', (value) => {
    inspected = true
    assert.equal(value, undefined)
    return 'checked'
  })

  const template = instance.compile('{{inspect (lookup (prototype) "constructor")}}')
  assert.equal(template({}, { allowProtoMethodsByDefault: true }), 'checked')
  assert.equal(inspected, true)
})

test('semantic-release still generates release notes with commit and comparison links', async () => {
  const hash = '1234567890abcdef1234567890abcdef12345678'
  const notes = await generateNotes({}, {
    cwd: process.cwd(),
    commits: [{ hash, message: 'fix(deps): update vulnerable dependency' }],
    lastRelease: { gitTag: 'v1.0.0' },
    nextRelease: { version: '1.0.1', gitTag: 'v1.0.1' },
    options: { repositoryUrl: 'https://github.com/IsaacThoman/pulpo.git' },
  })

  assert.match(notes, /Bug Fixes/)
  assert.match(notes, /update vulnerable dependency/)
  assert.ok(notes.includes(`https://github.com/IsaacThoman/pulpo/commit/${hash}`))
  assert.ok(notes.includes('https://github.com/IsaacThoman/pulpo/compare/v1.0.0...v1.0.1'))
})
