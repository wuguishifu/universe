Pod::Spec.new do |s|
  s.name           = 'SapphireSsh'
  s.version        = '0.0.1'
  s.summary        = 'Expo module exposing SSH over the tailnet to sapphire-mobile'
  s.author         = ''
  s.homepage       = 'https://github.com/wuguishifu/universe'
  s.license        = 'MIT'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  # The SSH client itself is Go, in the same gomobile framework as the tailnet node.
  s.dependency 'SapphireProxy'
  # Keychain helpers, and the vault for SSH keys stored in Bitwarden.
  s.dependency 'SapphireVaultCore'

  s.frameworks = 'LocalAuthentication', 'Security', 'UIKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '*.{h,m,swift}'
end
