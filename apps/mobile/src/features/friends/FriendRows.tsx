import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import type { FriendProfile } from '@pulpo/contracts'
import {
  Button as SwiftUIButton,
  HStack as SwiftUIHStack,
  Image as SwiftUIImage,
  RNHostView as SwiftUIRNHostView,
  Spacer as SwiftUISpacer,
  Text as SwiftUIText,
  VStack as SwiftUIVStack,
} from '@expo/ui/swift-ui'
import { accessibilityLabel, buttonStyle, contentShape, controlSize, disabled, font, foregroundStyle, lineLimit, shapes } from '@expo/ui/swift-ui/modifiers'
import { SymbolView } from '../../platform/SymbolView'
import { ListRow } from '../../mockup5/src/components/PrototypeUI'
import { ProfileAvatar } from '../../mockup5/src/components/ProfileAvatar'
import { useAppTheme } from '../../mockup5/src/theme'
import { profileDetail } from './format'

export function FriendAvatar({ profile, size }: { profile: FriendProfile; size: number }) {
  return <ProfileAvatar size={size} user={{ id: profile.id, name: profile.displayName, avatarUrl: profile.avatarUrl }} />
}

export function NativeRowButton({ label, onPress, prominent = false, isDisabled = false }: { label: string; onPress: () => void; prominent?: boolean; isDisabled?: boolean }) {
  return <SwiftUIButton label={label} onPress={onPress} modifiers={[buttonStyle(prominent ? 'borderedProminent' : 'bordered'), controlSize('small'), disabled(isDisabled)]} />
}

export function NativeCountHeader({ title, count }: { title: string; count: number }) {
  return <SwiftUIHStack><SwiftUIText>{title}</SwiftUIText><SwiftUISpacer /><SwiftUIText>{`${count}`}</SwiftUIText></SwiftUIHStack>
}

/**
 * A person in a SwiftUI form. With `onOpen`, their avatar and name open their profile; the
 * trailing actions stay separate buttons.
 */
export function NativePersonRow({ profile, detail, owner = false, trailing, onOpen }: {
  profile: FriendProfile
  detail?: string
  owner?: boolean
  trailing?: ReactNode
  onOpen?: () => void
}) {
  const theme = useAppTheme()
  // The spacer sits inside the identity so, when it opens a profile, the whole row up to the
  // trailing actions is the tap target.
  const identity = <SwiftUIHStack spacing={12} modifiers={onOpen ? [contentShape(shapes.rectangle())] : []}>
    <SwiftUIRNHostView matchContents><FriendAvatar profile={profile} size={36} /></SwiftUIRNHostView>
    <SwiftUIVStack alignment="leading" spacing={2}>
      <SwiftUIHStack spacing={5}>
        <SwiftUIText modifiers={[lineLimit(1)]}>{profile.displayName}</SwiftUIText>
        {owner ? <SwiftUIImage systemName="crown.fill" size={12} color={theme.orange} modifiers={[accessibilityLabel('Pool owner')]} /> : null}
      </SwiftUIHStack>
      {/* Two lines, so request ages and mutual counts survive the row's trailing buttons. */}
      <SwiftUIText modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary'), lineLimit(2)]}>{profileDetail(profile, detail)}</SwiftUIText>
    </SwiftUIVStack>
    <SwiftUISpacer />
  </SwiftUIHStack>
  return <SwiftUIHStack spacing={12}>
    {onOpen
      ? <SwiftUIButton onPress={onOpen} modifiers={[buttonStyle('plain'), accessibilityLabel(`${profile.displayName}, @${profile.username}${detail ? `, ${detail}` : ''}`)]}>{identity}</SwiftUIButton>
      : identity}
    {trailing}
  </SwiftUIHStack>
}

/** A person in a card, on Android and on the profile both platforms share; with `onOpen`, pressing the row opens their profile. */
export function MaterialPersonRow({ profile, detail, owner = false, last, onOpen, children }: {
  profile: FriendProfile
  detail?: string
  owner?: boolean
  last: boolean
  onOpen?: () => void
  children?: ReactNode
}) {
  const theme = useAppTheme()
  return <ListRow
    leading={<FriendAvatar profile={profile} size={40} />}
    title={profile.displayName}
    detail={profileDetail(profile, detail)}
    last={last}
    onPress={onOpen}
    chevron={!children}
  >{owner ? <SymbolView name="crown.fill" size={14} tintColor={theme.orange} accessibilityLabel="Pool owner" /> : null}{children ? <View style={styles.rowActions}>{children}</View> : null}</ListRow>
}

const styles = StyleSheet.create({
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
})
