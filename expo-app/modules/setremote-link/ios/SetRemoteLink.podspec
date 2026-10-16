Pod::Spec.new do |s|
  s.name           = 'SetRemoteLink'
  s.version        = '1.0.0'
  s.summary        = 'SetRemote : liaisons hors ligne télécommande ↔ écrans (Wi-Fi local, Bluetooth LE)'
  s.description    = 'Module Expo local : Bonjour + TCP (Network.framework) et GATT (CoreBluetooth), trames opaques.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  # Mode de langage Swift 5 (comme setremote-udp) : files Dispatch,
  # Network.framework et CoreBluetooth sans annotations Sendable.
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Network', 'CoreBluetooth', 'CryptoKit'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
