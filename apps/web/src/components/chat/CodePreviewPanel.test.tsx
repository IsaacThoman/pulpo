// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Markdown } from './Markdown'
import { CodePreviewPanel } from './CodePreviewPanel'
import { useCodePreview } from '@/stores/codePreview'

afterEach(() => {
  cleanup()
  useCodePreview.setState({ preview: null, hosts: 0 })
})

const jsx = 'export default function Mains() {\n  return <h1>Mains</h1>\n}'
const fence = (language: string, code: string) => `\`\`\`${language}\n${code}\n\`\`\``

function renderChat(content: string) {
  return render(<><Markdown content={content} /><CodePreviewPanel /></>)
}

function postFromFrame(frame: HTMLIFrameElement, data: unknown, source: MessageEventSource | null = frame.contentWindow) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source }))
  })
}

describe('code previews', () => {
  it('offers previews only for renderable languages', () => {
    const view = renderChat([fence('html', '<p>hi</p>'), fence('jsx', jsx), fence('ts', 'const a = 1'), fence('python', 'print(1)')].join('\n\n'))
    expect(view.getAllByRole('button', { name: 'Preview' })).toHaveLength(2)
  })

  it('hides the preview button when no panel is mounted', () => {
    const view = render(<Markdown content={fence('html', '<p>hi</p>')} />)
    expect(view.queryByRole('button', { name: 'Preview' })).toBeNull()
  })

  it('opens an opaque-origin sandbox and sends the code only after it is ready', () => {
    const view = renderChat(fence('jsx', jsx))
    fireEvent.click(view.getByRole('button', { name: 'Preview' }))

    const panel = view.getByTestId('code-preview-panel')
    expect(panel.textContent).toContain('Mains')
    const frame = view.getByTestId('sandbox-frame') as HTMLIFrameElement
    expect(frame.getAttribute('src')).toBe('/sandbox.html')
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-modals allow-popups allow-forms allow-downloads')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')

    const postMessage = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined)
    // Messages from other windows are ignored.
    postFromFrame(frame, { type: 'pulpo-sandbox:ready' }, window)
    expect(postMessage).not.toHaveBeenCalled()

    postFromFrame(frame, { type: 'pulpo-sandbox:ready' })
    postFromFrame(frame, { type: 'pulpo-sandbox:ready' })
    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith({ type: 'pulpo-sandbox:render', kind: 'jsx', code: jsx }, '*')

    postFromFrame(frame, { type: 'pulpo-sandbox:missing-styles', files: ['./src/styles.css'] })
    expect(view.getByText('Stylesheet not included: styles.css. The preview may look unstyled.')).toBeTruthy()

    postFromFrame(frame, { type: 'pulpo-sandbox:error', message: 'Boom' })
    expect(view.getByRole('alert').textContent).toContain('Boom')
  })

  it('switches to the source and closes', () => {
    const view = renderChat(fence('html', '<title>Landing</title><p>hi</p>'))
    fireEvent.click(view.getByRole('button', { name: 'Preview' }))
    fireEvent.click(view.getByRole('button', { name: 'Show code' }))
    expect(view.queryByTestId('sandbox-frame')).toBeNull()
    expect(view.getByTestId('code-preview-panel').textContent).toContain('<p>hi</p>')

    fireEvent.click(view.getByRole('button', { name: 'Close preview' }))
    expect(view.queryByTestId('code-preview-panel')).toBeNull()
  })
})
