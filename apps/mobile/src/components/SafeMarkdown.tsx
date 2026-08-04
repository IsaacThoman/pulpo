import { Linking } from 'react-native'
import Markdown from 'react-native-markdown-display'
import { useAppTheme } from '../theme'

export function SafeMarkdown({ children }: { children: string }) {
  const theme = useAppTheme()
  return <Markdown
    onLinkPress={(url) => {
      if (!/^https?:\/\//i.test(url)) return false
      void Linking.openURL(url)
      return false
    }}
    style={{
      body: { color: theme.text, fontSize: 16, lineHeight: 24 },
      paragraph: { marginTop: 0, marginBottom: 10 },
      link: { color: theme.blue },
      code_inline: { color: theme.text, backgroundColor: theme.fillStrong, fontFamily: 'Menlo', paddingHorizontal: 4, borderRadius: 4 },
      code_block: { color: theme.text, backgroundColor: theme.elevated, fontFamily: 'Menlo', padding: 12, borderRadius: 12 },
      fence: { color: theme.text, backgroundColor: theme.elevated, fontFamily: 'Menlo', padding: 12, borderRadius: 12 },
      blockquote: { borderLeftColor: theme.secondary, backgroundColor: theme.fill, color: theme.secondary },
      heading1: { color: theme.text }, heading2: { color: theme.text }, heading3: { color: theme.text },
    }}
  >{children}</Markdown>
}
