const fs = require('node:fs')
const path = require('node:path')
const { withXcodeProject } = require('@expo/config-plugins')

// App Intents must be compiled in the application target so Xcode extracts its
// action and phrase metadata. Keep their sources outside the generated ios/ tree.
module.exports = function withPulpoShortcuts(config) {
  return withXcodeProject(config, (modConfig) => {
    const { projectRoot, platformProjectRoot, projectName } = modConfig.modRequest
    const relativePath = `${projectName}/PulpoAppIntents.swift`
    const destination = path.join(platformProjectRoot, relativePath)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(path.join(projectRoot, 'modules/pulpo-shortcuts/intents/PulpoAppIntents.swift'), destination)
    const project = modConfig.modResults
    if (!project.hasFile(relativePath)) {
      project.addSourceFile(relativePath, { target: project.getFirstTarget().uuid }, project.getFirstProject().firstProject.mainGroup)
    }
    return modConfig
  })
}
