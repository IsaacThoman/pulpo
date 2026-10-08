import { buttonStyle, foregroundStyle, tint } from '@expo/ui/swift-ui/modifiers';
import { isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { Platform, PlatformColor } from 'react-native';

/** Liquid Glass requires iOS 26. Earlier iOS versions draw no glass at all. */
export const liquidGlassAvailable = Platform.OS === 'ios' && isGlassEffectAPIAvailable();

/**
 * `buttonStyle('glass' | 'glassProminent')`. Before iOS 26, SwiftUI's glass
 * styles fall back to a borderless button with no background, so use a filled
 * button there instead.
 *
 * Spread the result last in a modifier list: the first modifier wins, so a
 * caller's own `tint` or `foregroundStyle` overrides these fallback defaults.
 */
export function glassButtonStyle(style: 'glass' | 'glassProminent') {
  if (liquidGlassAvailable) return [buttonStyle(style)];
  if (style === 'glassProminent') return [buttonStyle('borderedProminent')];
  // An opaque gray fill hides content scrolling underneath, as glass does.
  return [
    buttonStyle('borderedProminent'),
    tint(PlatformColor('systemGray5')),
    foregroundStyle(PlatformColor('label')),
  ];
}
