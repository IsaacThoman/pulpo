const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { test } = require('node:test')
const vm = require('node:vm')

// Exercise the copy query-string actually loads for Expo Router's deep-link parser.
const queryStringPath = createRequire(require.resolve('expo-router')).resolve('query-string')
const queryString = require(queryStringPath)
const decodeUriComponentPath = createRequire(queryStringPath).resolve('decode-uri-component')
const decodeUriComponent = require(decodeUriComponentPath)
const { getStateFromPath } = require('expo-router/build/react-navigation/core/getStateFromPath')

test('query-string resolves the linear-time decoder fork', () => {
  const manifest = require(createRequire(decodeUriComponentPath).resolve('./package.json'))
  assert.equal(manifest.name, '@pulpo/decode-uri-component')
  assert.equal(typeof decodeUriComponent, 'function')
})

test('decodes malformed percent-encoded runs in linear time', () => {
  // The previous 0.2.2 release hangs for seconds at 1,000 repetitions and overflows the stack at 20,000.
  for (const unit of ['%C2', '%80', '%E0%A4', '%F0%9F%98', '%FE%FF%C3']) for (const repetitions of [1000, 20000]) {
    const input = unit.repeat(repetitions)
    for (const [label, decode] of [
      ['decoder', () => decodeUriComponent(input)],
      ['query-string', () => queryString.parse(`a=${input}&${input}=b`)],
      ['Expo Router', () => getStateFromPath(`/?a=${input}`)],
    ]) {
      // A VM timeout also catches a synchronous superlinear hang in this regression.
      assert.doesNotThrow(() => vm.runInNewContext('decode()', { decode }, { timeout: 2000 }), `${label}: ${unit} x${repetitions}`)
    }
  }
})

test('preserves the 0.2.x decoding contract', () => {
  for (const [input, expected] of [
    ['test', 'test'],
    ['a+b+c', 'a b c'],
    ['+test', ' test'],
    ['%', '%'],
    ['%%', '%%'],
    ['st%C3%A5le', 'ståle'],
    ['st%C3%A5le%', 'ståle%'],
    ['%%7Bst%C3%A5le%7D%', '%{ståle}%'],
    ['%ab%C3%A5le%', '%abåle%'],
    ['%C3%A5%able%', 'å%able%'],
    ['%7B%ab%7Bst%C3%A5le%7D%', '{%ab{ståle}%'],
    ['%7B%ab%%7Bst%C3%A5le%7D%%', '{%ab%{ståle}%%'],
    ['%FE%FF', '��'],
    ['%FF%FE', '��'],
    ['%C2', '�'],
    ['%C2x', '�x'],
    ['%C2%B5', 'µ'],
    ['%E2%82%AC+%E2%82', '€ %E2%82'],
  ]) {
    assert.equal(decodeUriComponent(input), expected, input)
  }
  assert.throws(() => decodeUriComponent(1), { name: 'TypeError' })
})

test('keeps query-string and Expo Router query parsing intact', () => {
  assert.deepEqual({ ...queryString.parse('?name=st%C3%A5le+%7Bx%7D&bad=%C2&tag=a&tag=b') }, {
    name: 'ståle {x}',
    bad: '�',
    tag: ['a', 'b'],
  })
  assert.equal(queryString.stringify({ q: 'ståle {x}' }), 'q=st%C3%A5le%20%7Bx%7D')
  const state = getStateFromPath('/chat?id=st%C3%A5le&bad=%E0%A4')
  assert.deepEqual(state.routes[0].params, { id: 'ståle', bad: '%E0%A4' })
})
