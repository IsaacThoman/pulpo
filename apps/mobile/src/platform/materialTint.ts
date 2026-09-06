import type { ColorValue } from 'react-native';
import type { MaterialColors } from '@expo/ui/jetpack-compose';

const resources: Record<string, keyof MaterialColors> = {
  '@color/pulpo_text': 'onSurface', '@color/pulpo_secondary': 'onSurfaceVariant',
  '@color/pulpo_primary': 'primary', '@color/pulpo_on_primary': 'onPrimary',
  '@color/pulpo_error': 'error', '@color/pulpo_outline': 'outlineVariant',
  '@color/pulpo_surface': 'surface', '@color/pulpo_container': 'surfaceContainer',
};
// Compose's Expo color converter accepts concrete colors, not RN resource maps.
export function materialTint(value: ColorValue | undefined, colors: MaterialColors): ColorValue | undefined {
  if (!value || typeof value !== 'object') return value;
  const names = (value as { resource_paths?: string[] }).resource_paths ?? [];
  const key = names.map((name) => resources[name]).find(Boolean);
  return key ? colors[key] : colors.onSurface;
}
