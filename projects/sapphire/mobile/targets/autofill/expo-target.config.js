/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'credentials-provider',
  name: 'autofill',
  displayName: 'Sapphire',
  bundleIdentifier: '.autofill',
  deploymentTarget: '17.0',
  frameworks: ['AuthenticationServices', 'LocalAuthentication', 'SwiftUI'],
  entitlements: {
    'com.apple.developer.authentication-services.autofill-credential-provider': true,
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups'],
    // Only the shared group: the refresh token in the app's own group stays out of reach.
    'keychain-access-groups': [
      '$(AppIdentifierPrefix)dev.wuguishifu.sapphire.shared',
    ],
  },
});
