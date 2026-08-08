import type { ExpoConfig } from 'expo/config'

// mockup-5 owns its native-stack transitions while Expo Router remains the app entry point.
process.env.EXPO_ROUTER_DISABLE_RN_NAVIGATION_CHECK ??= '1'

const defaultInstanceUrl = process.env.EXPO_PUBLIC_DEFAULT_INSTANCE_URL ?? 'https://pulpo.baby'
const appVersion = process.env.PULPO_APP_VERSION ?? '1.0.0'
const iosBuildNumber = process.env.PULPO_IOS_BUILD_NUMBER ?? '1'

const config: ExpoConfig = {
  name: 'Pulpo',
  slug: 'pulpo',
  owner: 'isaacthoman',
  version: appVersion,
  orientation: 'portrait',
  scheme: 'pulpo',
  icon: './assets/pulpo-app-icon.png',
  userInterfaceStyle: 'automatic',
  experiments: { typedRoutes: true },
  ios: {
    bundleIdentifier: 'com.isaacthoman.pulpo',
    buildNumber: iosBuildNumber,
    supportsTablet: false,
    appleTeamId: 'PX72AL9366',
    icon: './assets/pulpo-app-icon.png',
    associatedDomains: ['applinks:pulpo.baby'],
    infoPlist: {
      CFBundleDisplayName: 'Pulpo',
      ITSAppUsesNonExemptEncryption: false,
      NSCameraUsageDescription: 'Allow Pulpo to take photos to attach to your chats.',
      NSPhotoLibraryUsageDescription: 'Allow Pulpo to attach photos to your chats.',
    },
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] },
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace', NSPrivacyAccessedAPITypeReasons: ['E174.1'] },
      ],
      NSPrivacyCollectedDataTypes: [
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeName',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeEmailAddress',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeUserID',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypeOtherUserContent',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
        {
          NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePhotosorVideos',
          NSPrivacyCollectedDataTypeLinked: true,
          NSPrivacyCollectedDataTypeTracking: false,
          NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
        },
      ],
      NSPrivacyTracking: false,
    },
  },
  android: {
    package: 'com.isaacthoman.pulpo',
    blockedPermissions: ['android.permission.RECORD_AUDIO'],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-sqlite',
    [
      'expo-build-properties',
      { ios: { deploymentTarget: '26.0', useFrameworks: 'dynamic', buildReactNativeFromSource: true } },
    ],
    ['react-native-enriched-markdown', { enableMath: true }],
    [
      'expo-image-picker',
      {
        photosPermission: 'Allow Pulpo to attach photos to your chats.',
        cameraPermission: 'Allow Pulpo to take photos to attach to your chats.',
        microphonePermission: false,
      },
    ],
    [
      'expo-splash-screen',
      {
        backgroundColor: '#FFFFFF',
        image: './assets/pulpo-smiley.png',
        imageWidth: 112,
        resizeMode: 'contain',
        dark: { backgroundColor: '#000000', image: './assets/pulpo-smiley.png' },
      },
    ],
  ],
  extra: {
    defaultInstanceUrl,
    eas: {},
  },
}

export default config
