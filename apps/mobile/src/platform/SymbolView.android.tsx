import type { SymbolViewProps } from 'expo-symbols';
import { View } from 'react-native';
import { Host, Icon, useMaterialColors } from '@expo/ui/jetpack-compose';
import { materialTint } from './materialTint';
import { materialIcon } from './materialIcons';

// Vector symbols keep their geometry when the user enlarges text. They also
// avoid exposing icon-font code points as spoken labels to accessibility tools.
export function SymbolView({ name, size = 24, tintColor, style, accessibilityLabel, ...props }: SymbolViewProps) {
  const colors = useMaterialColors();
  const symbol = typeof name === 'string' ? name : name.android ?? name.ios ?? 'info';
  return <View pointerEvents="none" style={[{ width: size, height: size, flexShrink: 0 }, style]} accessible={Boolean(accessibilityLabel)} accessibilityLabel={accessibilityLabel} importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'} testID={props.testID}>
    <Host style={{ width: size, height: size }} pointerEvents="none" ignoreSafeAreaKeyboardInsets><Icon source={materialIcon(symbol)} size={size} tint={materialTint(tintColor, colors) ?? colors.onSurface} /></Host>
  </View>;
}
