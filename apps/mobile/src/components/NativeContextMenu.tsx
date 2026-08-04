import type { ReactNode } from 'react'
import { Platform, View, type ViewStyle } from 'react-native'
import {
  Button,
  ContextMenu,
  ControlGroup,
  Divider,
  Host,
  RNHostView,
} from '@expo/ui/swift-ui'

export interface ContextAction {
  label: string
  systemImage: string
  destructive?: boolean
  grouped?: boolean
  onPress: () => void
}

export function NativeContextMenu({ children, preview, actions, style }: {
  children: ReactNode
  preview?: ReactNode
  actions: Array<ContextAction | 'divider'>
  style?: ViewStyle
}) {
  if (Platform.OS !== 'ios') return <View style={style}>{children}</View>
  const groups: ReactNode[] = []
  let grouped: ContextAction[] = []
  const flush = () => {
    if (!grouped.length) return
    groups.push(<ControlGroup key={`group-${groups.length}`}>{grouped.map((action) => <Button key={action.label} label={action.label} systemImage={action.systemImage as never} role={action.destructive ? 'destructive' : 'default'} onPress={action.onPress} />)}</ControlGroup>)
    grouped = []
  }
  for (const action of actions) {
    if (action === 'divider') { flush(); groups.push(<Divider key={`divider-${groups.length}`} />); continue }
    if (action.grouped) { grouped.push(action); continue }
    flush()
    groups.push(<Button key={action.label} label={action.label} systemImage={action.systemImage as never} role={action.destructive ? 'destructive' : 'default'} onPress={action.onPress} />)
  }
  flush()
  return <Host ignoreSafeArea="all" matchContents style={style}>
    <ContextMenu>
      <ContextMenu.Trigger><RNHostView matchContents><>{children}</></RNHostView></ContextMenu.Trigger>
      {preview ? <ContextMenu.Preview><RNHostView matchContents><>{preview}</></RNHostView></ContextMenu.Preview> : null}
      <ContextMenu.Items>{groups}</ContextMenu.Items>
    </ContextMenu>
  </Host>
}
