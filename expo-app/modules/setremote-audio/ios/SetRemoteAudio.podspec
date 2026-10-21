Pod::Spec.new do |s|
  s.name           = 'SetRemoteAudio'
  s.version        = '1.0.0'
  s.summary        = 'SetRemote : audio de l\'appel décroché (écouteur, haut-parleur, capteur de proximité)'
  s.description    = 'Module Expo local : AVAudioSession playAndRecord / voiceChat, AVAudioPlayer, proximité UIDevice.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  # Mode de langage Swift 5 (comme setremote-udp et setremote-link)
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'UIKit'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
