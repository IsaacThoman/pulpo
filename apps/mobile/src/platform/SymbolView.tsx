import { SymbolView as ExpoSymbolView, type SymbolViewProps } from 'expo-symbols';
import { materialSymbolNames, type AppSymbolViewProps } from './symbolNames';

export function SymbolView({ name, ...props }: AppSymbolViewProps) {
  const resolved = typeof name === 'string'
    ? { ios: name, android: materialSymbolNames[name] ?? 'help_outline', web: materialSymbolNames[name] ?? 'help_outline' }
    : name;
  return <ExpoSymbolView {...props} name={resolved as SymbolViewProps['name']} />;
}
