import { createContext } from 'react'

/** Whether the surrounding Markdown is still streaming in, for blocks that wait for their whole content. */
export const MarkdownStreamingContext = createContext(false)
