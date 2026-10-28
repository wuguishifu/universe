import Foundation
import Network
import Sapphireproxy

/// The local tailnet proxy as a Network.framework proxy configuration. WebViews get it through
/// the default data store; anything native that needs the tailnet (e.g. sapphire-vault's
/// URLSession) uses it directly.
public enum TailnetProxy {
  public static func configuration(port: Int) -> ProxyConfiguration {
    let endpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: NWEndpoint.Port(integerLiteral: UInt16(port)))
    return ProxyConfiguration(httpCONNECTProxy: endpoint)
  }

  /// The running proxy's configuration, or nil before `start` has brought it up.
  public static func current() -> ProxyConfiguration? {
    let port = SapphireproxyProxyPort()
    return port > 0 ? configuration(port: port) : nil
  }

  /// Adds a line to the tailnet's log buffer, next to the proxy's own.
  public static func log(_ line: String) {
    SapphireproxyLog(line)
  }

  /// An ephemeral URLSession that tunnels every request through the tailnet proxy.
  public static func session() -> URLSession? {
    guard let proxy = current() else { return nil }
    let configuration = URLSessionConfiguration.ephemeral
    configuration.proxyConfigurations = [proxy]
    return URLSession(configuration: configuration)
  }
}
