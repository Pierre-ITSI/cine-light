Pod::Spec.new do |s|
  s.name           = 'SetRemoteUdp'
  s.version        = '1.0.0'
  s.summary        = 'SetRemote : réception et envoi UDP pour la passerelle DMX (sACN, Art-Net)'
  s.description    = 'Module Expo local : sockets BSD (unicast, broadcast) et Network.framework (multicast sACN).'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  # Mode de langage Swift 5 (comme expo-keep-awake) : files Dispatch et
  # Network.framework sans annotations Sendable.
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Network'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
