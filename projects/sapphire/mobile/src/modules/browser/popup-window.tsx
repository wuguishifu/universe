import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { useColors } from '../theme';

/**
 * react-native-webview has no real popup support: `window.open()` returns
 * null and the target is loaded into the opener's own WebView. SSO flows that
 * open a popup and wait for the result in the opener (PocketBase/Beszel opens
 * a blank popup first, then sets its location) end up replacing the opener
 * with about:blank.
 *
 * This shim gives pages a stand-in window whose navigations and close() are
 * forwarded to the app, which shows them in a separate WebView. It shares
 * cookies and the proxy with the opener, but has no `window.opener`.
 */
export const WINDOW_OPEN_SHIM = `(function () {
  var current = null;

  function send(message) {
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  }

  function createWindow() {
    var href = 'about:blank';
    var closed = false;

    function navigate(url) {
      if (closed || url == null || String(url) === 'about:blank') return;
      href = new URL(String(url), document.baseURI).href;
      send({ type: 'sapphire:open-window', url: href });
    }

    var location = { assign: navigate, replace: navigate, reload: function () {} };
    Object.defineProperty(location, 'href', {
      get: function () { return href; },
      set: navigate,
    });

    var win = {
      opener: window,
      focus: function () {},
      blur: function () {},
      postMessage: function () {},
      close: function () {
        if (closed) return;
        closed = true;
        send({ type: 'sapphire:close-window' });
      },
      _markClosed: function () { closed = true; },
    };
    Object.defineProperty(win, 'location', {
      get: function () { return location; },
      set: navigate,
    });
    Object.defineProperty(win, 'closed', {
      get: function () { return closed; },
    });
    return win;
  }

  window.open = function (url) {
    if (current) current._markClosed();
    current = createWindow();
    current.location.href = url;
    return current;
  };

  // Called by the app when the user dismisses the popup.
  window.__sapphireWindowClosed = function () {
    if (current) current._markClosed();
  };
})();
true;`;

export const WINDOW_CLOSED_SCRIPT =
  'window.__sapphireWindowClosed && window.__sapphireWindowClosed(); true;';

export type WindowMessage =
  | { type: 'sapphire:open-window'; url: string }
  | { type: 'sapphire:close-window' };

export function parseWindowMessage(
  event: WebViewMessageEvent,
): WindowMessage | undefined {
  try {
    const message = JSON.parse(event.nativeEvent.data);
    if (
      message?.type === 'sapphire:open-window' ||
      message?.type === 'sapphire:close-window'
    ) {
      return message;
    }
  } catch {
    // Not one of ours.
  }
  return undefined;
}

export function PopupWindow({
  url,
  onDismiss,
}: {
  url?: string;
  onDismiss: () => void;
}) {
  const colors = useColors();

  return (
    <Modal
      visible={!!url}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onDismiss}
    >
      <View style={[styles.header, { borderColor: colors.border }]}>
        <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>
          {url?.replace(/^\w+:\/\/([^/?#]+).*$/, '$1')}
        </Text>
        <Pressable onPress={onDismiss} hitSlop={8}>
          <Text style={{ color: colors.accent, fontSize: 17 }}>Done</Text>
        </Pressable>
      </View>
      {url && (
        <WebView
          source={{ uri: url }}
          incognito={false}
          sharedCookiesEnabled
          style={{ flex: 1 }}
        />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
  },
});
