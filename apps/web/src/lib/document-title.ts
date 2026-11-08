import { useEffect } from 'react'

const DEFAULT_DOCUMENT_TITLE = 'Pulpo'

export function useDocumentTitle(title?: string | null): void {
  useEffect(() => {
    document.title = title && title.trim().length > 0 ? title : DEFAULT_DOCUMENT_TITLE
  }, [title])

  useEffect(() => {
    return () => {
      document.title = DEFAULT_DOCUMENT_TITLE
    }
  }, [])
}
