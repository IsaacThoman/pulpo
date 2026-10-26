import { memo, useMemo } from 'react'
import type { TextStyle, ViewStyle } from 'react-native'
import { SafeMarkdown } from '../../components/SafeMarkdown'
import { assistantMarkdownParts } from './parts'
import { QuizBuildingCard, QuizCard } from './QuizCard'

/** A reply's Markdown, with its quiz blocks as interactive cards. */
export const AssistantMarkdown = memo(function AssistantMarkdown({ children, streaming = false, selectable, containerStyle, tightenLeadingHeading = false }: {
  children: string
  streaming?: boolean
  selectable?: boolean
  containerStyle?: ViewStyle | TextStyle
  tightenLeadingHeading?: boolean
}) {
  const parts = useMemo(() => assistantMarkdownParts(children, streaming), [children, streaming])
  const lastMarkdown = parts.findLastIndex((part) => part.kind === 'markdown')
  return <>{parts.map((part, index) => {
    if (part.kind === 'building') return <QuizBuildingCard key={`quiz:${index}`} />
    if (part.kind === 'quiz') return <QuizCard key={`quiz:${index}`} progressKey={part.source} quiz={part.quiz} />
    return <SafeMarkdown
      containerStyle={containerStyle}
      key={`markdown:${index}`}
      selectable={selectable}
      streaming={streaming && index === lastMarkdown}
      tightenLeadingHeading={tightenLeadingHeading && index === 0}
    >{part.text}</SafeMarkdown>
  })}</>
})
