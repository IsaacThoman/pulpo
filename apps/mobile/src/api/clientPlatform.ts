import * as Application from 'expo-application'
import Constants from 'expo-constants'
import { Platform } from 'react-native'

/** `ios/<version>` or `android/<version>` for the `x-pulpo-client` attribution header. */
export function mobileClientPlatform(): string | null {
  const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null
  if (!platform) return null
  const version = (Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? '').trim().toLowerCase()
  return /^[0-9a-z.+-]{1,32}$/.test(version) ? `${platform}/${version}` : platform
}
