Pod::Spec.new do |s|
  s.name           = 'SapphireVault'
  s.version        = '0.0.1'
  s.summary        = 'Expo module exposing the Vaultwarden client to sapphire-mobile'
  s.author         = ''
  s.homepage       = 'https://github.com/wuguishifu/universe'
  s.license        = 'MIT'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'SapphireProxy'
  s.dependency 'SapphireVaultCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '*.{h,m,swift}'
end
