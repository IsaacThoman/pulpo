const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const path = require('node:path')
const { test } = require('node:test')

const expoRequire = createRequire(require.resolve('@expo/cli/package.json'))

for (const consumer of ['apps/server', 'apps/web', 'apps/cli', 'packages/contracts']) {
  const { z } = createRequire(path.resolve(consumer, 'package.json'))('zod')

  test(`${consumer}: Zod rejects oversized collections before parsing their elements`, async () => {
    let parsed = 0
    const element = z.string().refine(() => { parsed++; return true })
    const cases = [
      [z.array(element).max(2), ['a', 'b', 'c']],
      [z.array(element).length(2), ['a', 'b', 'c']],
      [z.map(element, element).max(2), new Map([['a', 'a'], ['b', 'b'], ['c', 'c']])],
      [z.set(element).max(2), new Set(['a', 'b', 'c'])],
    ]
    for (const [schema, input] of cases) {
      for (const result of [schema.safeParse(input), await schema.safeParseAsync(input)]) {
        assert.equal(result.success, false)
        assert.equal(result.error.issues.length, 1)
        assert.equal(result.error.issues[0].code, 'too_big')
      }
    }
    assert.equal(parsed, 0)
    assert.deepEqual(z.array(element).max(2).parse(['a', 'b']), ['a', 'b'])
  })
}

test('Expo CLI uses the patched Zod and still validates plugins, output, and MCP commands', () => {
  const { z } = expoRequire('zod')
  assert.equal(z, require('zod').z)
  const { PluginSchema, DevToolsPluginOutputSchema } = expoRequire('./build/src/start/server/DevToolsPlugin.schema.js')
  const { createMCPDevToolsExtensionSchema } = expoRequire('./build/src/start/server/createMCPDevToolsExtensionSchema.js')
  const plugin = {
    packageName: 'test-plugin',
    packageRoot: '/tmp/test-plugin',
    cliExtensions: {
      description: 'Security regression fixture',
      entryPoint: 'cli.js',
      commands: [{
        name: 'inspect', title: 'Inspect', environments: ['cli', 'mcp'],
        parameters: [
          { name: 'target', type: 'text' },
          { name: 'count', type: 'number' },
          { name: 'confirm', type: 'confirm' },
        ],
      }],
    },
  }
  assert.equal(PluginSchema.safeParse(plugin).success, true)
  assert.equal(PluginSchema.safeParse({ ...plugin, packageName: '' }).success, false)
  const schema = createMCPDevToolsExtensionSchema(plugin)
  const args = { command: 'inspect', target: 'app', count: 2, confirm: true }
  assert.deepEqual(schema.parse(args), args)
  assert.equal(schema.safeParse({ command: 'unknown' }).success, false)
  assert.equal(schema.safeParse({ ...args, count: '2' }).success, false)
  assert.equal(schema.safeParse({ ...args, extra: true }).success, false)
  const jsonSchema = z.toJSONSchema(schema)
  assert.deepEqual(jsonSchema.properties.command.enum, ['inspect'])
  assert.equal(jsonSchema.additionalProperties, false)
  const output = [
    { type: 'text', text: 'ok', level: 'info' },
    { type: 'audio', url: 'https://example.com/audio.mp3' },
    { type: 'image', url: 'https://example.com/image.png' },
  ]
  assert.deepEqual(DevToolsPluginOutputSchema.parse(output), output)
  assert.equal(DevToolsPluginOutputSchema.safeParse([{ type: 'text', text: 1 }]).success, false)
})
