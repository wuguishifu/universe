import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { WebView } from 'react-native-webview';

export default function BrowseScreen() {
  const { url } = useLocalSearchParams<{ url: string }>();
  const [title, setTitle] = useState(url);

  return (
    <>
      <Stack.Screen options={{ title }} />
      <WebView
        source={{ uri: url }}
        onNavigationStateChange={(nav) => setTitle(nav.title || nav.url)}
        // The proxy is configured on the default (persistent) data store.
        incognito={false}
        allowsBackForwardNavigationGestures
        sharedCookiesEnabled
        style={{ flex: 1 }}
      />
    </>
  );
}
