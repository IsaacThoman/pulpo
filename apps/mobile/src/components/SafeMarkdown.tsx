import { memo, useMemo } from 'react'
import { Linking, StyleSheet, type TextStyle, type ViewStyle } from 'react-native'
import { EnrichedMarkdownText, type MarkdownStyle } from 'react-native-enriched-markdown'
import { useAppTheme } from '../theme'
import { beginsWithMarkdownHeading, normalizeMathDelimiters } from './markdown'

export const SafeMarkdown = memo(function SafeMarkdown({
  children,
  compact = false,
  containerStyle,
  tightenLeadingHeading = false,
}: {
  children: string
  streaming?: boolean
  compact?: boolean
  containerStyle?: ViewStyle | TextStyle
  tightenLeadingHeading?: boolean
}) {
  const theme = useAppTheme()
  const markdown = useMemo(() => normalizeMathDelimiters(children), [children])
  const markdownStyle = useMemo<MarkdownStyle>(() => {
    const fontSize = compact ? 13 : 16
    const lineHeight = compact ? 19 : 24
    return {
      paragraph: { color: compact ? theme.secondary : theme.text, fontSize, lineHeight, marginBottom: compact ? 6 : 10 },
      h1: { color: theme.text, fontSize: compact ? 18 : 24, lineHeight: compact ? 23 : 30, marginTop: 11, marginBottom: 8 },
      h2: { color: theme.text, fontSize: compact ? 16 : 21, lineHeight: compact ? 22 : 27, marginTop: 11, marginBottom: 7 },
      h3: { color: theme.text, fontSize: compact ? 14 : 18, lineHeight: compact ? 20 : 24, marginTop: 10, marginBottom: 6 },
      h4: { color: theme.text, fontSize, lineHeight, marginTop: 9, marginBottom: 5 },
      h5: { color: theme.text, fontSize, lineHeight, marginTop: 9, marginBottom: 5 },
      h6: { color: theme.secondary, fontSize, lineHeight, marginTop: 9, marginBottom: 5 },
      list: { color: compact ? theme.secondary : theme.text, fontSize, lineHeight, markerColor: theme.secondary, bulletColor: theme.secondary, gapWidth: 8, marginLeft: 18, marginBottom: 8 },
      strong: { color: theme.text },
      em: { color: compact ? theme.secondary : theme.text },
      link: { color: theme.blue, underline: true },
      code: { color: theme.text, backgroundColor: theme.fillStrong, borderColor: theme.separator, fontFamily: 'Menlo', fontSize: Math.max(11, fontSize - 2) },
      codeBlock: { color: theme.text, backgroundColor: theme.elevated, borderColor: theme.separator, borderWidth: 1, borderRadius: 10, fontFamily: 'Menlo', fontSize: Math.max(11, fontSize - 2), lineHeight: Math.max(16, lineHeight - 3), padding: 12, marginBottom: 10 },
      blockquote: { color: theme.secondary, backgroundColor: theme.fill, borderColor: theme.secondary, borderWidth: 2, gapWidth: 10, fontSize, lineHeight, marginBottom: 10 },
      thematicBreak: { color: theme.separator, height: 1, marginTop: 12, marginBottom: 12 },
      table: { color: theme.text, fontSize: Math.max(12, fontSize - 2), lineHeight: Math.max(17, lineHeight - 4), headerBackgroundColor: theme.fillStrong, headerTextColor: theme.text, rowEvenBackgroundColor: theme.fill, rowOddBackgroundColor: theme.background, borderColor: theme.separator, borderWidth: 1, borderRadius: 10, cellPaddingHorizontal: 9, cellPaddingVertical: 7, marginBottom: 12 },
      taskList: { checkedColor: theme.blue, borderColor: theme.secondary, checkmarkColor: theme.background, checkedTextColor: theme.secondary },
      math: { color: theme.text, backgroundColor: theme.fill, padding: 12, marginTop: 8, marginBottom: 12, textAlign: 'center' },
      inlineMath: { color: theme.text },
    }
  }, [compact, theme])

  if (!markdown) return null
  return <EnrichedMarkdownText
    // The native renderer can retain its attributed-string colors when its
    // style prop changes in place. Remount on theme transitions so every text
    // run is rebuilt from the newly resolved palette.
    key={theme.isDark ? 'markdown-dark' : 'markdown-light'}
    accessibilityRole="text"
    allowTrailingMargin={false}
    containerStyle={StyleSheet.flatten([
      styles.fill,
      containerStyle,
      tightenLeadingHeading && beginsWithMarkdownHeading(markdown) && styles.tightLeadingHeading,
    ])}
    flavor="github"
    markdown={markdown}
    markdownStyle={markdownStyle}
    maxFontSizeMultiplier={2}
    onLinkPress={({ url }) => {
      if (/^https?:\/\//i.test(url)) void Linking.openURL(url)
    }}
    selectable
    // Socket snapshots already stream the source markdown. The renderer's
    // additional tail animation can report a stale intrinsic height on iOS,
    // leaving later content underneath sibling controls and outside the list's
    // scrollable extent. Render each snapshot directly so native layout stays
    // authoritative throughout the response.
    streamingAnimation={false}
  />
})

const styles = StyleSheet.create({
  fill: { width: '100%', maxWidth: '100%', minWidth: 0 },
  tightLeadingHeading: { marginTop: -8 },
})
