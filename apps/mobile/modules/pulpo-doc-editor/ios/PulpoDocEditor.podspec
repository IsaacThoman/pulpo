Pod::Spec.new do |s|
  s.name           = 'PulpoDocEditor'
  s.version        = '1.0.0'
  s.summary        = 'Hosts Pulpo’s collaborative document editor in a web view with a native formatting bar.'
  s.description    = 'An app-local Expo module: a locked-down WKWebView for the bundled editor page and its bridge.'
  s.author         = 'Pulpo'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '18.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'WebKit', 'SwiftUI'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
