Pod::Spec.new do |s|
  s.name           = 'PulpoFileClipboard'
  s.version        = '1.0.0'
  s.summary        = 'Copies Pulpo attachment files through an iOS item provider.'
  s.description    = 'An app-local Expo module for publishing files to UIPasteboard.'
  s.author         = 'Pulpo'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '26.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
