import { SymbolView, type SFSymbol } from 'expo-symbols'

export function Icon({ name, size = 36, color }: { name: SFSymbol; size?: number; color: string }) {
  return <SymbolView name={name} size={size} tintColor={color} weight="semibold" style={{ width: size, height: size }} />
}
