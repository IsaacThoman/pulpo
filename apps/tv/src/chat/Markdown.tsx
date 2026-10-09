import { Fragment } from 'react'
import { Text, View, type TextStyle } from 'react-native'
import { type TVTheme, type } from '../theme'
import type { Block, Inline } from './blocks'

const MONO = 'Menlo'

function InlineNodes({ nodes, theme }: { nodes: Inline[]; theme: TVTheme }) {
  return <>{nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={index}>{node.text}</Fragment>
      case 'break':
        return <Fragment key={index}>{'\n'}</Fragment>
      case 'code':
        return <Text key={index} style={{ fontFamily: MONO, backgroundColor: theme.fillStrong, fontSize: type.body - 4 }}>{` ${node.text} `}</Text>
      case 'strong':
        return <Text key={index} style={{ fontWeight: '700' }}><InlineNodes nodes={node.children} theme={theme} /></Text>
      case 'em':
        return <Text key={index} style={{ fontStyle: 'italic' }}><InlineNodes nodes={node.children} theme={theme} /></Text>
      case 'del':
        return <Text key={index} style={{ textDecorationLine: 'line-through' }}><InlineNodes nodes={node.children} theme={theme} /></Text>
      case 'link':
        return <Text key={index} style={{ color: theme.blue }}><InlineNodes nodes={node.children} theme={theme} /></Text>
    }
  })}</>
}

const headingSize: Record<number, number> = { 1: 44, 2: 40, 3: 36 }

function BlockView({ block, theme, color }: { block: Block; theme: TVTheme; color: string }) {
  const body: TextStyle = { fontSize: type.body, lineHeight: type.body * 1.45, color }
  switch (block.type) {
    case 'heading':
      return <Text style={[body, { fontSize: headingSize[block.depth] ?? type.body + 2, lineHeight: (headingSize[block.depth] ?? type.body) * 1.3, fontWeight: '700' }]}>
        <InlineNodes nodes={block.inline} theme={theme} />
      </Text>
    case 'paragraph':
      return <Text style={body}><InlineNodes nodes={block.inline} theme={theme} /></Text>
    case 'code':
    case 'math':
      return <View style={{ backgroundColor: theme.fill, borderRadius: 16, padding: 24 }}>
        <Text style={{ fontFamily: MONO, fontSize: type.body - 6, lineHeight: (type.body - 6) * 1.45, color }}>{block.text.replace(/\n+$/, '')}</Text>
      </View>
    case 'list':
      return <View style={{ gap: 10 }}>{block.items.map((item, index) => (
        <View key={index} style={{ flexDirection: 'row', paddingLeft: item.depth * 40, gap: 16 }}>
          <Text style={[body, { minWidth: 36, color: theme.secondary }]}>{item.marker}</Text>
          <Text style={[body, { flex: 1 }]}><InlineNodes nodes={item.inline} theme={theme} /></Text>
        </View>
      ))}</View>
    case 'quote':
      return <View style={{ borderLeftWidth: 6, borderLeftColor: theme.separator, paddingLeft: 24, gap: 16 }}>
        {block.blocks.map((child, index) => <BlockView key={index} block={child} theme={theme} color={theme.secondary} />)}
      </View>
    case 'table':
      return <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 2, borderColor: theme.separator }}>
        {[block.header, ...block.rows].map((row, rowIndex) => (
          <View key={rowIndex} style={{ flexDirection: 'row', backgroundColor: rowIndex === 0 ? theme.fill : undefined, borderTopWidth: rowIndex ? 2 : 0, borderTopColor: theme.separator }}>
            {row.map((cell, cellIndex) => (
              <Text key={cellIndex} style={[body, { flex: 1, padding: 16, fontSize: type.body - 4, lineHeight: (type.body - 4) * 1.4, fontWeight: rowIndex === 0 ? '700' : '400' }]}>
                <InlineNodes nodes={cell} theme={theme} />
              </Text>
            ))}
          </View>
        ))}
      </View>
    case 'rule':
      return <View style={{ height: 2, backgroundColor: theme.separator }} />
  }
}

export function MarkdownBlocks({ blocks, theme, color }: { blocks: Block[]; theme: TVTheme; color?: string }) {
  return <View style={{ gap: 24 }}>
    {blocks.map((block, index) => <BlockView key={index} block={block} theme={theme} color={color ?? theme.text} />)}
  </View>
}
