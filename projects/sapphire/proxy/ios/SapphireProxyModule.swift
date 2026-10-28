import ExpoModulesCore
import Network
import Sapphireproxy
import WebKit

public class SapphireProxyModule: Module {
  public func definition() -> ModuleDefinition {
    Name("SapphireProxy")

    AsyncFunction("start") { (hostname: String) async throws -> Int in
      var error: NSError?
      SapphireproxyStart(try stateDir(), hostname, &error)
      if let error {
        throw error
      }

      let port = SapphireproxyProxyPort()
      await routeWebViews(port: port)
      return port
    }

    AsyncFunction("stop") {
      SapphireproxyStop()
    }

    AsyncFunction("status") { () -> String in
      var error: NSError?
      let status = SapphireproxyStatus(&error)
      if let error {
        throw error
      }
      return status
    }

    AsyncFunction("logout") {
      var error: NSError?
      SapphireproxyLogout(&error)
      if let error {
        throw error
      }
    }

    Function("logs") {
      SapphireproxyRecentLogs()
    }

    Function("log") { (line: String) in
      SapphireproxyLog(line)
    }
  }

  private func stateDir() throws -> String {
    let dir = try FileManager.default
      .url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      .appendingPathComponent("tailscale", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.path
  }

  // react-native-webview uses the default data store (unless incognito), so
  // every WebView in the app tunnels through the local proxy via CONNECT.
  @MainActor
  private func routeWebViews(port: Int) {
    WKWebsiteDataStore.default().proxyConfigurations = [TailnetProxy.configuration(port: port)]
  }
}
