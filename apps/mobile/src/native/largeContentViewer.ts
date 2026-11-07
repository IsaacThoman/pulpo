import { createModifier } from '@expo/ui/swift-ui/modifiers'

/**
 * Shows a fixed-size SwiftUI control's label in the Large Content Viewer: at accessibility
 * text sizes, touching and holding it shows its title (and symbol) enlarged in the middle of the screen.
 */
export function largeContentViewer(title: string, systemImage?: string) {
  return createModifier('pulpoLargeContentViewer', systemImage ? { title, systemImage } : { title })
}
