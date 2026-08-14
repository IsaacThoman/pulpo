Pod::Spec.new do |s|
  s.name           = 'PulpoAttachmentPreview'
  s.version        = '1.0.0'
  s.summary        = 'Presents Pulpo attachments with iOS Quick Look.'
  s.description    = 'An app-local Expo module for native fullscreen document previews.'
  s.author         = 'Pulpo'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '26.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'QuickLook'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
