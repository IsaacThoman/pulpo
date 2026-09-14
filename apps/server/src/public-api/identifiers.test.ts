import { expect, it } from 'vitest'
import { assertPublicIdentifier } from './identifiers.js'
import { parseChatCompletionRequest, parseCompletionRequest, parseResponsesRequest } from './codecs.js'

it.each(['model\0', 'model\ud800', 'model\udfff'])('rejects unsupported model identifiers in every public protocol', model => {
  for (const [parse, body] of [
    [parseChatCompletionRequest, { messages: [{ role: 'user', content: 'Hi' }] }],
    [parseCompletionRequest, { prompt: 'Hi' }],
    [parseResponsesRequest, { input: 'Hi' }],
  ] as const) {
    expect(() => parse({ model, ...body }))
      .toThrowError(expect.objectContaining({ statusCode: 400, param: 'model', code: 'validation_error' }))
  }
})

it('keeps valid identifiers, Unicode and literal escape sequences unchanged', () => {
  for (const value of ['model-1', '模型🐙', 'model\\u0000']) expect(() => assertPublicIdentifier(value, 'model')).not.toThrow()
})
