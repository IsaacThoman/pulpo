Pod::Spec.new do |s|
  s.name           = 'PulpoSpeechTranscriber'
  s.version        = '1.0.0'
  s.summary        = 'Transcribes Pulpo dictation recordings on device.'
  s.description    = 'An app-local Expo module wrapping Apple SpeechAnalyzer and SpeechTranscriber.'
  s.author         = 'Pulpo'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '26.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Speech', 'AVFoundation'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
