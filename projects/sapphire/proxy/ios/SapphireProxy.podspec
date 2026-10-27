Pod::Spec.new do |s|
  s.name           = 'SapphireProxy'
  s.version        = '0.0.1'
  s.summary        = 'Embedded tsnet node + localhost proxy for sapphire-mobile'
  s.author         = ''
  s.homepage       = 'https://github.com/wuguishifu/universe'
  s.license        = 'MIT'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Built by `nx build-ios sapphire-proxy` (gomobile bind).
  s.vendored_frameworks = 'Frameworks/Sapphireproxy.xcframework'
  s.frameworks = 'WebKit', 'Network'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '*.{h,m,swift}'
end
