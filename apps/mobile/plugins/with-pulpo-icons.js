const fs = require('node:fs')
const path = require('node:path')
const { withDangerousMod } = require('@expo/config-plugins')

const ICON_SETS = ['LucideFlaskConical.imageset', 'LucideFlaskConicalWhite.imageset']

module.exports = function withPulpoIcons(config) {
  return withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const sourceCatalog = path.join(modConfig.modRequest.projectRoot, 'assets', 'ios', 'PulpoIcons.xcassets')
      const destinationCatalog = path.join(
        modConfig.modRequest.platformProjectRoot,
        modConfig.modRequest.projectName,
        'Images.xcassets',
      )

      for (const iconSet of ICON_SETS) {
        fs.cpSync(path.join(sourceCatalog, iconSet), path.join(destinationCatalog, iconSet), {
          force: true,
          recursive: true,
        })
      }

      return modConfig
    },
  ])
}
