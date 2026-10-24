/** Lucide's kebab-case icon names map to the PascalCase components lucide-react-native exports. */
export function lucideComponentName(name: string): string {
  return name.split('-').map((part) => part ? `${part[0]!.toUpperCase()}${part.slice(1)}` : '').join('')
}

