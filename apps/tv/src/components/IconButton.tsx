import type { SFSymbol } from 'expo-symbols'
import { Text, View } from 'react-native'
import { useTVTheme, type } from '../theme'
import { Focusable, type FocusableProps } from './Focusable'
import { Icon } from './Icon'

/** A round icon control, or a pill when it carries a short label. */
export function IconButton({ icon, label, tint, ...props }: Omit<FocusableProps, 'children'> & {
  icon: SFSymbol
  label?: string
  tint?: string
}) {
  const theme = useTVTheme()
  return <Focusable
    accessibilityRole="button"
    accessibilityLabel={label}
    {...props}
    style={[{
      height: 76, minWidth: 76, borderRadius: 38, paddingHorizontal: label ? 30 : 0,
      alignItems: 'center', justifyContent: 'center',
    }, props.style]}
  >
    {(focused) => <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <Icon name={icon} size={32} color={focused ? theme.focusText : tint ?? theme.text} />
      {label ? <Text style={{ fontSize: type.label, fontWeight: '600', color: focused ? theme.focusText : theme.text }}>{label}</Text> : null}
    </View>}
  </Focusable>
}
