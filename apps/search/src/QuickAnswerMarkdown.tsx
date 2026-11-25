import Markdown from 'react-markdown'
import { safeHttpUrl } from './navigation'

export default function AnswerMarkdown({ text }: { text: string }) {
  return <div className="quick-answer-markdown">
    <Markdown skipHtml disallowedElements={['img', 'video', 'audio', 'iframe']} urlTransform={url => safeHttpUrl(url)?.href ?? ''}
      components={{
        a: ({ href, children }) => href
          ? <a href={href} target="_blank" rel="noreferrer">{children}</a>
          : <span>{children}</span>,
      }}>{text}</Markdown>
  </div>
}
