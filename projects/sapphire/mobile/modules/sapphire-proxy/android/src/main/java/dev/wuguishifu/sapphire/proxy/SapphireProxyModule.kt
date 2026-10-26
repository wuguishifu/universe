package dev.wuguishifu.sapphire.proxy

import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.WebViewFeature
import dev.wuguishifu.sapphire.sapphireproxy.Sapphireproxy
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.net.NetworkInterface
import java.util.concurrent.Executor
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

class SapphireProxyModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SapphireProxy")

    AsyncFunction("start") Coroutine { hostname: String ->
      val context = appContext.reactContext ?: throw CodedException("No React context")
      val dir = File(context.filesDir, "tailscale").apply { mkdirs() }

      // Go can't enumerate interfaces on Android 11+; hand it the list from Java.
      Sapphireproxy.setInterfaces(interfaceSpec())
      Sapphireproxy.start(dir.absolutePath, hostname)

      val port = Sapphireproxy.proxyPort()
      routeWebViews(port)
      port
    }

    AsyncFunction("stop") {
      Sapphireproxy.stop()
    }

    AsyncFunction("status") {
      Sapphireproxy.status()
    }

    AsyncFunction("logout") {
      Sapphireproxy.logout()
    }

    Function("logs") {
      Sapphireproxy.recentLogs()
    }
  }

  // Applies to every WebView in the process.
  private suspend fun routeWebViews(port: Long) {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
      throw CodedException("This WebView doesn't support proxy overrides")
    }
    val config = ProxyConfig.Builder()
      .addProxyRule("http://127.0.0.1:$port")
      .build()
    val direct = Executor { it.run() }
    suspendCoroutine { cont ->
      ProxyController.getInstance().setProxyOverride(config, direct) { cont.resume(Unit) }
    }
  }

  private fun interfaceSpec(): String {
    val flag = { b: Boolean -> if (b) "1" else "0" }
    return NetworkInterface.getNetworkInterfaces().toList().joinToString("\n") { iface ->
      val addrs = iface.interfaceAddresses.joinToString(",") {
        "${it.address.hostAddress?.substringBefore('%')}/${it.networkPrefixLength}"
      }
      listOf(
        iface.name,
        iface.index,
        iface.mtu,
        flag(iface.isUp),
        flag(iface.isLoopback),
        flag(iface.isPointToPoint),
        flag(iface.supportsMulticast()),
        addrs,
      ).joinToString("|")
    }
  }
}
