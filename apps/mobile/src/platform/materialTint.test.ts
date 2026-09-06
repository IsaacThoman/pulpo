import { expect, it } from 'vitest';
import type { ColorValue } from 'react-native';
import type { MaterialColors } from '@expo/ui/jetpack-compose';
import { materialTint } from './materialTint';

it('resolves resource-backed RN colors before crossing the Compose color bridge', () => {
  const colors = { onSurface: '#101010', primary: '#445599', error: '#bb2222' } as unknown as MaterialColors;
  expect(materialTint({ resource_paths: ['@color/pulpo_primary'] } as unknown as ColorValue, colors)).toBe('#445599');
  expect(materialTint({ resource_paths: ['@color/pulpo_error'] } as unknown as ColorValue, colors)).toBe('#bb2222');
  expect(materialTint('#123456', colors)).toBe('#123456');
  expect(materialTint(undefined, colors)).toBeUndefined();
});
