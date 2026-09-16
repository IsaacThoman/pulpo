const fs = require('node:fs')
const path = require('node:path')
const { withAppDelegate, withInfoPlist, withXcodeProject } = require('@expo/config-plugins')

const marker = '// Pulpo: the scene owns the React Native window.'
function migrateAppDelegate(source) {
  if (source.includes(marker)) return source
  const windowStartup = /#if os\(iOS\) \|\| os\(tvOS\)\s+window = UIWindow\(frame: UIScreen\.main\.bounds\)\s+factory\.startReactNative\(\s+withModuleName: "main",\s+in: window,\s+launchOptions: launchOptions\)\s+#endif/
  if (!source.includes('  var window: UIWindow?') || !windowStartup.test(source)) {
    throw new Error('Pulpo scene migration: the Expo AppDelegate template changed; update the scene integration before building.')
  }
  return source
    .replace('  var window: UIWindow?', '  var window: UIWindow?\n  var reactNativeLaunchOptions: [UIApplication.LaunchOptionsKey: Any]?')
    .replace(windowStartup, `    ${marker}\n    reactNativeLaunchOptions = launchOptions`)
}

function configureSceneManifest(plist) {
  plist.UIApplicationSceneManifest = {
    UIApplicationSupportsMultipleScenes: false,
    UISceneConfigurations: {
      UIWindowSceneSessionRoleApplication: [{
        UISceneConfigurationName: 'Default Configuration',
        UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).PulpoSceneDelegate',
      }],
    },
  }
  return plist
}

module.exports = function withPulpoScenes(config) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults = configureSceneManifest(mod.modResults)
    return mod
  })
  config = withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== 'swift') throw new Error('Pulpo scene migration requires a Swift AppDelegate.')
    mod.modResults.contents = migrateAppDelegate(mod.modResults.contents)
    return mod
  })
  return withXcodeProject(config, (mod) => {
    const { projectRoot, platformProjectRoot, projectName } = mod.modRequest
    const relativePath = `${projectName}/PulpoSceneDelegate.swift`
    const destination = path.join(platformProjectRoot, relativePath)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(path.join(projectRoot, 'plugins/ios/PulpoSceneDelegate.swift'), destination)
    const project = mod.modResults
    if (!project.hasFile(relativePath)) {
      project.addSourceFile(relativePath, { target: project.getFirstTarget().uuid }, project.getFirstProject().firstProject.mainGroup)
    }
    return mod
  })
}
module.exports.migrateAppDelegate = migrateAppDelegate
module.exports.configureSceneManifest = configureSceneManifest
