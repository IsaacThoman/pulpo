import type { ExpoConfig } from 'expo/config'

// This project only builds for Apple TV; EXPO_TV keeps the Expo CLI in TV mode.
process.env.EXPO_TV = '1'

const appVersion = process.env.PULPO_APP_VERSION ?? '1.0.0'
const buildNumber = process.env.PULPO_IOS_BUILD_NUMBER ?? '1'

const config: ExpoConfig = {
  name: 'Pulpo',
  slug: 'pulpo-tv',
  owner: 'isaacthoman',
  version: appVersion,
  platforms: ['ios'],
  scheme: 'pulpo',
  userInterfaceStyle: 'automatic',
  ios: {
    // Shared with the iPhone app for universal purchase.
    bundleIdentifier: 'com.isaacthoman.pulpo',
    buildNumber,
    appleTeamId: 'PX72AL9366',
    infoPlist: {
      CFBundleDisplayName: 'Pulpo',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  plugins: [
    ['@react-native-tvos/config-tv', {
      isTV: true,
      tvosDeploymentTarget: '26.0',
      appleTVImages: {
        iconLayers: {
          front: './assets/tv/icon-front-1280x768.png',
          middle: './assets/tv/icon-middle-1280x768.png',
          back: './assets/tv/icon-back-1280x768.png',
        },
        iconSmallLayers: {
          front: './assets/tv/icon-front-400x240.png',
          middle: './assets/tv/icon-middle-400x240.png',
          back: './assets/tv/icon-back-400x240.png',
        },
        iconSmall2xLayers: {
          front: './assets/tv/icon-front-800x480.png',
          middle: './assets/tv/icon-middle-800x480.png',
          back: './assets/tv/icon-back-800x480.png',
        },
        topShelf: './assets/tv/top-shelf-1920x720.png',
        topShelf2x: './assets/tv/top-shelf-3840x1440.png',
        topShelfWide: './assets/tv/top-shelf-wide-2320x720.png',
        topShelfWide2x: './assets/tv/top-shelf-wide-4640x1440.png',
      },
    }],
    // Shared with the iPhone app: tvOS 27 also requires scene-based startup.
    '../mobile/plugins/with-pulpo-scenes',
    'expo-secure-store',
    'expo-sqlite',
    ['expo-build-properties', { ios: { buildReactNativeFromSource: true } }],
    ['expo-splash-screen', {
      backgroundColor: '#FFFFFF',
      image: './assets/brand-mark.png',
      imageWidth: 200,
      resizeMode: 'contain',
      dark: { backgroundColor: '#000000', image: './assets/brand-mark.png' },
    }],
  ],
}

export default config
