Pod::Spec.new do |s|
  s.name           = 'PulpoStoreKit'
  s.version        = '1.0.0'
  s.summary        = 'StoreKit 2 subscriptions for Pulpo.'
  s.description    = 'An app-local Expo module for buying, restoring, and managing App Store subscriptions.'
  s.author         = 'Pulpo'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '26.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'StoreKit'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
