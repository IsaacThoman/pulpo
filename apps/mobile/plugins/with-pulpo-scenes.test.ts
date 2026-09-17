import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { migrateAppDelegate, configureSceneManifest } = require('./with-pulpo-scenes.js')
const template = `class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?
  public override func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    let factory = ExpoReactNativeFactory(delegate: delegate)
    reactNativeFactory = factory
#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}`

describe('iOS scene lifecycle prebuild migration', () => {
  it('defers window creation until a scene connects while retaining Expo startup and launch options', () => {
    const source = migrateAppDelegate(template)
    expect(source).not.toContain('UIScreen.main.bounds')
    expect(source).not.toContain('factory.startReactNative(')
    expect(source).toContain('reactNativeFactory = factory')
    expect(source).toContain('reactNativeLaunchOptions = launchOptions')
    expect(source).toContain('super.application(application, didFinishLaunchingWithOptions: launchOptions)')
  })
  it('can prebuild repeatedly and fails loudly for an unsupported template', () => {
    const migrated = migrateAppDelegate(template)
    expect(migrateAppDelegate(migrated)).toBe(migrated)
    expect(() => migrateAppDelegate(template.replace('UIScreen.main.bounds', 'unknownBounds'))).toThrow('template changed')
  })
  it('registers the scene delegate without enabling multiple runtimes or dropping URL/document configuration', () => {
    const plist = { CFBundleURLTypes: [{ CFBundleURLSchemes: ['pulpo'] }], CFBundleDocumentTypes: [{ LSItemContentTypes: ['public.data'] }] }
    const result = configureSceneManifest({ ...plist })
    expect(result).toMatchObject(plist)
    expect(result.UIApplicationSceneManifest).toEqual({
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: { UIWindowSceneSessionRoleApplication: [{ UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).PulpoSceneDelegate' }] },
    })
  })
})
