const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { test } = require('node:test')

// Exercise each consumer's copy, including any future nested installation.
for (const consumer of ['@expo/metro-file-map', 'metro-file-map', '@semantic-release/commit-analyzer', 'semantic-release']) {
  const micromatchPath = createRequire(require.resolve(consumer)).resolve('micromatch')
  const micromatch = require(micromatchPath)
  const braces = createRequire(micromatchPath)('braces')

  test(`${consumer}: rejects excessive brace and parenthesis nesting before walking`, () => {
    for (const [open, close] of [['{', '}'], ['(', ')']]) {
      for (const depth of [101, 4000]) {
        const pattern = open.repeat(depth) + 'a,b' + close.repeat(depth)
        for (const method of [braces, braces.parse, braces.compile, braces.expand, braces.stringify]) {
          assert.throws(() => method(pattern), { name: 'SyntaxError', message: /exceeds max depth/ })
        }
      }
      const allowed = open.repeat(100) + 'a' + close.repeat(100)
      for (const method of [braces, braces.parse, braces.compile, braces.expand, braces.stringify]) {
        assert.doesNotThrow(() => method(allowed))
      }
    }
  })

  test(`${consumer}: bounds caller-supplied ASTs and cannot raise the safety cap`, () => {
    for (const method of [braces.compile, braces.expand, braces.stringify]) {
      let ast = { type: 'text', value: 'a' }
      for (let i = 0; i < 4000; i++) ast = { type: 'brace', nodes: [ast] }
      ast = { type: 'root', nodes: [ast] }
      assert.throws(() => method(ast), { name: 'RangeError', message: /exceeds max depth/ })
      assert.throws(() => method('{'.repeat(101) + 'a,b' + '}'.repeat(101), { maxDepth: Infinity }), /exceeds max depth/)
      assert.throws(() => method('{'.repeat(101) + 'a,b' + '}'.repeat(101), { maxDepth: 10000 }), /exceeds max depth/)
      assert.throws(() => method('{{a,b},c}', { maxDepth: 1.5 }), /exceeds max depth/)
      assert.doesNotThrow(() => method('{a,b}', { maxDepth: 1.5 }))
    }
  })

  test(`${consumer}: preserves normal expansion, escaping, and glob matching`, () => {
    assert.deepEqual(braces.expand('src/{api,worker}/{1..3}.ts'), [
      'src/api/1.ts', 'src/api/2.ts', 'src/api/3.ts',
      'src/worker/1.ts', 'src/worker/2.ts', 'src/worker/3.ts',
    ])
    assert.equal(braces.compile('src/{api,worker}.ts'), 'src/(api|worker).ts')
    assert.deepEqual(braces.expand('foo/({a,b})'), ['foo/(a)', 'foo/(b)'])
    for (const pattern of ['{{a}}', '{a,{b,{c}}', '{}{a}']) {
      assert.equal(braces.stringify(braces.parse(pattern), { escapeInvalid: true }), pattern)
    }
    assert.deepEqual(micromatch(['src/api.ts', 'src/worker.ts', 'src/other.ts'], 'src/{api,worker}.ts'), ['src/api.ts', 'src/worker.ts'])
    assert.deepEqual(micromatch.braceExpand('src/{api,worker}.ts'), ['src/api.ts', 'src/worker.ts'])
    assert.throws(() => micromatch.braces('{'.repeat(4000) + 'a,b' + '}'.repeat(4000)), /exceeds max depth/)
  })
}

test('braces expansion rejects cyclic AST parent chains without hanging', () => {
  const braces = require('braces')
  for (const selfReference of [true, false]) {
    const ast = { type: 'paren', nodes: [{ type: 'text', value: 'a' }] }
    ast.parent = selfReference ? ast : { type: 'paren', parent: ast }
    // A VM timeout also catches a synchronous infinite loop in this regression.
    assert.throws(() => require('node:vm').runInNewContext('braces.expand(ast)', { braces, ast }, { timeout: 1000 }),
      { name: 'RangeError', message: /parent chain contains a cycle/ })
  }
})
