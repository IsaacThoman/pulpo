import { Platform } from 'react-native'
import PulpoFileClipboard from '../../modules/pulpo-file-clipboard'

/**
 * Hosted SwiftUI controls keep reporting their accessibility frame from before a transform moved
 * them (the drawer slide). Call once such a move has settled; keyboard moves are handled natively.
 */
export function refreshAccessibilityFrames() {
  if (Platform.OS === 'ios') PulpoFileClipboard?.refreshAccessibilityFrames?.()
}
