Pod::Spec.new do |s|
  s.name = 'PulpoShortcuts'
  s.version = '1.0.0'
  s.summary = 'Account-scoped native Apple Shortcuts for Pulpo.'
  s.description = 'Secure session bridge and API client for Pulpo App Intents.'
  s.author = 'Pulpo'
  s.homepage = 'https://github.com/IsaacThoman/pulpo'
  s.platforms = { :ios => '26.0' }
  s.source = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Security', 'CryptoKit'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '*.swift'
end
