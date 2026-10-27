import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import {
  parseWindowMessage,
  PopupWindow,
  WINDOW_CLOSED_SCRIPT,
  WINDOW_OPEN_SHIM,
} from '../modules/browser/popup-window';
import { useColors } from '../modules/theme';

export default function BrowseScreen() {
  const { url } = useLocalSearchParams<{ url: string }>();
  const [title, setTitle] = useState(url);
  const [popupUrl, setPopupUrl] = useState<string>();
  const webView = useRef<WebView>(null);

  const colors = useColors();

  const dismissPopup = () => {
    setPopupUrl(undefined);
    webView.current?.injectJavaScript(WINDOW_CLOSED_SCRIPT);
  };

  return (
    <SafeAreaView
      edges={['top']}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 16,
          paddingBottom: 8,
        }}
      >
        <TouchableOpacity onPress={() => router.back()}>
          <ChevronLeft color={colors.text} />
        </TouchableOpacity>
        <Text style={{ color: colors.text }}>{title}</Text>
      </View>
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
        incognito={false}
        allowsBackForwardNavigationGestures
        sharedCookiesEnabled
        style={{ flex: 1, backgroundColor: colors.background }}
      />
      <PopupWindow url={popupUrl} onDismiss={dismissPopup} />
    </SafeAreaView>
  );
}
