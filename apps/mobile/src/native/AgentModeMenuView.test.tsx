// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

type Selection = { enabled: boolean; revision: number; scope: string }
type NativeProps = {
  configuration: Selection & { available: boolean; hint: string }
  onSelectionChange: (event: { nativeEvent: Selection }) => void
}
const native = vi.hoisted(() => ({ props: null as NativeProps | null }))
vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }))
vi.mock('expo-modules-core', () => ({
  requireNativeViewManager: () => (props: NativeProps) => { native.props = props; return null },
}))
import { AgentModeMenuView } from './AgentModeMenuView'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it.each([true, false])('does not acknowledge a native tap with the older composer value %s', async (enabled) => {
  const root = createRoot(document.createElement('div'))
  const onSelectionChange = vi.fn()
  try {
    await act(async () => root.render(<AgentModeMenuView enabled={enabled} revision={0} available hint="Agent options" onSelectionChange={onSelectionChange} />))
    const { scope } = native.props!.configuration
    await act(async () => {
      native.props!.onSelectionChange({ nativeEvent: { enabled: !enabled, revision: 1, scope } })
    })
    // The composer has not supplied the new value yet. Crediting revision 1
    // here would tell native to restore the old tint while it waits.
    expect(native.props!.configuration).toMatchObject({ enabled, revision: 0 })
    expect(onSelectionChange).toHaveBeenCalledWith({ enabled: !enabled, revision: 1 })
    await act(async () => root.render(<AgentModeMenuView enabled={!enabled} revision={1} available hint="Agent options" onSelectionChange={onSelectionChange} />))
    expect(native.props!.configuration).toMatchObject({ enabled: !enabled, revision: 1 })
  } finally {
    await act(async () => root.unmount())
  }
})

it('acknowledges rapid selections together and rejects stale or foreign events', async () => {
  const changes: boolean[] = []
  function Composer() {
    const [selection, setSelection] = useState({ enabled: true, revision: 0 })
    return <AgentModeMenuView {...selection} available hint="Opens agent choices" onSelectionChange={value => {
      changes.push(value.enabled)
      setSelection(value)
    }} />
  }
  const root = createRoot(document.createElement('div'))
  try {
    await act(async () => root.render(<Composer />))
    const { scope } = native.props!.configuration
    const select = (enabled: boolean, revision: number, eventScope = scope) =>
      native.props!.onSelectionChange({ nativeEvent: { enabled, revision, scope: eventScope } })
    await act(async () => {
      select(false, 1)
      select(true, 2)
    })
    expect(changes).toEqual([false, true])
    expect(native.props!.configuration).toMatchObject({ enabled: true, revision: 2 })
    await act(async () => {
      select(false, 1)
      select(false, 3, 'another-composer')
    })
    expect(changes).toEqual([false, true])
    expect(native.props!.configuration).toMatchObject({ enabled: true, revision: 2 })
  } finally {
    await act(async () => root.unmount())
  }
})
