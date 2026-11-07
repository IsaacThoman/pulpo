// Only call-argument spreads are unsafe: array/object spreads don't consume argument slots.
function unwrap(node) {
  while (node.type === 'TSAsExpression' || node.type === 'TSTypeAssertion' || node.type === 'TSNonNullExpression') node = node.expression
  return node
}

export default {
  meta: { name: 'pulpo' },
  rules: {
    'no-input-sized-arguments': {
      meta: {
        type: 'problem',
        schema: [],
        messages: { unsafe: 'Use maxOf/minOf/pushAll or a loop: spreading an input-sized collection can exceed the JavaScript argument limit.' },
      },
      create(context) {
        return {
          CallExpression(node) {
            const callee = node.callee
            if (callee.type !== 'MemberExpression') return
            const property = callee.computed ? callee.property.value : callee.property.name
            const extrema = callee.object.type === 'Identifier' && callee.object.name === 'Math' && (property === 'max' || property === 'min')
            if (!extrema && property !== 'push') return
            for (const argument of node.arguments) {
              if (argument.type !== 'SpreadElement') continue
              const value = unwrap(argument.argument)
              // A literal with no nested spread has a statically fixed number of arguments.
              if (value.type === 'ArrayExpression' && value.elements.every((element) => element?.type !== 'SpreadElement')) continue
              context.report({ node: argument, messageId: 'unsafe' })
            }
          },
        }
      },
    },
  },
}
