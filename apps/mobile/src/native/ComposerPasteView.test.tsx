// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

type NativeProps = {
  onPasteStart: (event: { nativeEvent: { id?: string } }) => void
  onPasteFiles: (event: { nativeEvent: { id?: string; files?: unknown[]; failed?: number } }) => void
}
const native = vi.hoisted(() => ({ props: null as NativeProps | null }))
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-modules-core', () => ({
  requireNativeViewManager: () => (props: NativeProps) => { native.props = props; return null },
}))
import { ComposerPasteView } from './ComposerPasteView'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const file = { uri: 'file:///cache/pasted-files/a/image.png', name: 'image.png', mimeType: 'image/png', size: 12 }

it('hands back each paste with the context read when it started', async () => {
  let draft = 'chat-a'
  const onPasteFiles = vi.fn()
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(
      <ComposerPasteView onPasteFiles={onPasteFiles} pasteContext={() => draft}>{null}</ComposerPasteView>,
    ))
    native.props!.onPasteStart({ nativeEvent: { id: 'one' } })
    draft = 'chat-b'
    native.props!.onPasteStart({ nativeEvent: { id: 'two' } })
    native.props!.onPasteFiles({ nativeEvent: { id: 'two', files: [file], failed: 0 } })
    native.props!.onPasteFiles({ nativeEvent: { id: 'one', files: [], failed: 1 } })
    expect(onPasteFiles.mock.calls).toEqual([
      [{ files: [file], failed: 0 }, 'chat-b'],
      [{ files: [], failed: 1 }, 'chat-a'],
    ])

    // Results for unknown or already reported pastes are ignored.
    native.props!.onPasteFiles({ nativeEvent: { id: 'one', files: [file], failed: 0 } })
    native.props!.onPasteFiles({ nativeEvent: { files: [file], failed: 0 } })
    expect(onPasteFiles).toHaveBeenCalledTimes(2)
  } finally {
    await act(async () => root.unmount())
  }
})
