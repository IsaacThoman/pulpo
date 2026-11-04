Pod::Spec.new do |s|
  s.name           = 'PulpoStoreKit'
  s.version        = '1.0.0'
  s.summary        = 'Buys and restores Pulpo subscriptions with StoreKit 2.'
  s.description    = 'An app-local Expo module that wraps StoreKit 2 products, purchases, and transactions.'
  s.author         = 'Pulpo'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '18.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
