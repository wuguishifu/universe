import { Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { WebView } from 'react-native-webview';

import {
  parseWindowMessage,
  PopupWindow,
  WINDOW_CLOSED_SCRIPT,
  WINDOW_OPEN_SHIM,
} from '../modules/browser/popup-window';

export default function BrowseScreen() {
  const { url } = useLocalSearchParams<{ url: string }>();
  const [title, setTitle] = useState(url);
  const [popupUrl, setPopupUrl] = useState<string>();
  const webView = useRef<WebView>(null);

  const dismissPopup = () => {
    setPopupUrl(undefined);
    webView.current?.injectJavaScript(WINDOW_CLOSED_SCRIPT);
  };

  return (
    <>
      <Stack.Screen options={{ title }} />
      <WebView
        ref={webView}
        source={{ uri: url }}
        onNavigationStateChange={(nav) => setTitle(nav.title || nav.url)}
        injectedJavaScriptBeforeContentLoaded={WINDOW_OPEN_SHIM}
        onMessage={(event) => {
          const message = parseWindowMessage(event);
          if (message?.type === 'sapphire:open-window') {
            setPopupUrl(message.url);
          } else if (message?.type === 'sapphire:close-window') {
            setPopupUrl(undefined);
          }
        }}
        // The proxy is configured on the default (persistent) data store.
        incognito={false}
        allowsBackForwardNavigationGestures
        sharedCookiesEnabled
        style={{ flex: 1 }}
      />
      <PopupWindow url={popupUrl} onDismiss={dismissPopup} />
    </>
  );
}
