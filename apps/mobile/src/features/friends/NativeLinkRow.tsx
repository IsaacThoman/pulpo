import { Button, HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui'
import { background, buttonStyle, contentShape, font, foregroundStyle, frame, lineLimit, padding, shapes } from '@expo/ui/swift-ui/modifiers'
import { useAppTheme } from '../../mockup5/src/theme'

/** A SwiftUI form row that opens another screen: an icon, a title, maybe a detail and a count. */
export function NativeLinkRow({ icon, title, detail, badge, onPress }: { icon: string; title: string; detail?: string; badge?: string; onPress: () => void }) {
  const theme = useAppTheme()
  return <Button modifiers={[buttonStyle('plain'), foregroundStyle('primary')]} onPress={onPress}>
    <HStack spacing={12} modifiers={[contentShape(shapes.rectangle())]}>
      <Image systemName={icon as never} size={17} modifiers={[frame({ width: 22, height: 22 })]} />
      {detail ? <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ textStyle: 'subheadline', weight: 'medium' }), lineLimit(2)]}>{title}</Text>
        <Text modifiers={[font({ textStyle: 'footnote' }), foregroundStyle('secondary'), lineLimit(3)]}>{detail}</Text>
      </VStack> : <Text>{title}</Text>}
      <Spacer />
      {badge ? <Text modifiers={[font({ textStyle: 'footnote', weight: 'semibold' }), foregroundStyle('white'), padding({ horizontal: 7, vertical: 2 }), background(theme.red, shapes.capsule())]}>{badge}</Text> : null}
      <Image systemName="chevron.right" size={11} />
    </HStack>
  </Button>
}
