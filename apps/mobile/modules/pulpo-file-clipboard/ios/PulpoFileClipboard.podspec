Pod::Spec.new do |s|
  s.name           = 'PulpoFileClipboard'
  s.version        = '1.0.0'
  s.summary        = 'Copies, exports and saves Pulpo attachment files on iOS.'
  s.description    = 'An app-local Expo module for publishing files to UIPasteboard.'
  s.author         = 'Pulpo'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '18.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'ExpoUI'
  s.frameworks = 'Photos', 'UIKit'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
