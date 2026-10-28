Pod::Spec.new do |s|
  s.name           = 'SapphireVaultCore'
  s.version        = '0.0.1'
  s.summary        = 'Vaultwarden client core shared by sapphire-mobile and its AutoFill extension'
  s.author         = ''
  s.homepage       = 'https://github.com/wuguishifu/universe'
  s.license        = 'MIT'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }
  s.swift_version  = '5.9'

  # No Expo or React Native here: the AutoFill extension links this pod on its own.
  s.source_files = 'Core/**/*.swift'
  s.resource_bundles = { 'SapphireVaultCore' => ['Core/Resources/*.dat'] }
  s.frameworks = 'AuthenticationServices', 'LocalAuthentication', 'Security'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }
end
