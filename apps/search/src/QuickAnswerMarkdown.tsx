import { Check, Copy } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import { safeHttpUrl } from './navigation'

function AnswerCode({ children }: { children: ReactNode }) {
  const code = useRef<HTMLPreElement>(null)
  const [status, setStatus] = useState('')
  return <div className="quick-answer-code">
    <pre ref={code}>{children}</pre>
    {typeof navigator.clipboard?.writeText === 'function' && <button type="button" className="icon-button" aria-label="Copy code" title="Copy code"
      onClick={async () => {
        if (!code.current?.textContent) return
        try {
          await navigator.clipboard.writeText(code.current.textContent)
          setStatus('Code copied.')
        } catch {
          setStatus('Couldn’t copy code.')
        }
      }}>
      {status === 'Code copied.' ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
    </button>}
    <span className="sr-only" role="status">{status}</span>
  </div>
}

export default function AnswerMarkdown({ text }: { text: string }) {
  return <div className="quick-answer-markdown">
    <Markdown skipHtml disallowedElements={['img', 'video', 'audio', 'iframe']} urlTransform={url => safeHttpUrl(url)?.href ?? ''}
      components={{
        pre: ({ children }) => <AnswerCode>{children}</AnswerCode>,
        a: ({ href, children }) => href
          ? <a href={href} target="_blank" rel="noreferrer">{children}</a>
          : <span>{children}</span>,
      }}>{text}</Markdown>
  </div>
}
