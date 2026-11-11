import type { FileReference } from '@pulpo/contracts'
import { Pressable, Text, View, type ColorValue, type StyleProp, type TextStyle, type ViewStyle } from 'react-native'
import { SymbolView } from '../../../platform/SymbolView'
import { useFileReferenceDetails } from '../referenceDetails'

/**
 * The look of the attachment cards a reference card stands beside, from the chat's styles, so a
 * Files item mentioned in a message has the same shape, size, and spacing as a file attached to it.
 */
export interface FileReferenceCardAppearance {
  card: StyleProp<ViewStyle>
  tile: StyleProp<ViewStyle>
  copy: StyleProp<ViewStyle>
  name: StyleProp<TextStyle>
  meta: StyleProp<TextStyle>
  pressed: StyleProp<ViewStyle>
  /** The small mark on the tile that tells a reference from an attachment. */
  badge: StyleProp<ViewStyle>
  badgeColor: ColorValue
  /** The tint of an item that is gone, and of the chevron. */
  mutedColor: ColorValue
  tileIconSize: number
  /** Ends the card with a chevron, as in a sent message. */
  chevron?: boolean
}

interface Props {
  namespace: string | null | undefined
  reference: FileReference
  appearance: FileReferenceCardAppearance
  onOpen: (reference: FileReference) => void
}

/** A Files item a message mentions, as a card like an attachment's that opens the item in Files. */
export function FileReferenceCard({ namespace, reference, appearance, onOpen }: Props) {
  const details = useFileReferenceDetails(namespace, reference)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={details.missing ? `${details.name}, no longer in Files` : `Open ${details.name}, ${details.detail}`}
      accessibilityState={{ disabled: details.missing }}
      disabled={details.missing}
      onPress={() => onOpen(reference)}
      style={({ pressed }) => [appearance.card, pressed && appearance.pressed]}
    >
      <View style={appearance.tile}>
        <SymbolView name={details.icon.symbol as never} size={appearance.tileIconSize} tintColor={details.missing ? appearance.mutedColor : details.icon.tint} />
        {details.missing ? null : (
          <View style={appearance.badge}>
            <SymbolView name="link" size={7} tintColor={appearance.badgeColor} weight="bold" />
          </View>
        )}
      </View>
      <View style={appearance.copy}>
        <Text numberOfLines={1} style={appearance.name}>{details.name}</Text>
        <Text numberOfLines={1} style={appearance.meta}>{details.detail}</Text>
      </View>
      {appearance.chevron && !details.missing ? <SymbolView name="chevron.right" size={13} tintColor={appearance.mutedColor} /> : null}
    </Pressable>
  )
}
