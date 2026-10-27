import { useEffect, useRef, useState, type Ref } from 'react';
import { ActivityIndicator, Animated, StyleSheet, View } from 'react-native';
import {
  WebView,
  type WebViewMessageEvent,
  type WebViewProps,
} from 'react-native-webview';

import { useColors } from '../theme';

/**
 * Posts once the page has rendered a frame. Runs at document end, and
 * requestAnimationFrame waits on render-blocking stylesheets, so by the time
 * the second frame callback fires the page's own background is on screen.
 */
const FIRST_PAINT_SCRIPT = `requestAnimationFrame(function () {
  requestAnimationFrame(function () {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'sapphire:painted' }));
  });
});
true;`;

/** Fallback for pages that never run the script (PDFs, images, CSP). */
const LOAD_END_FALLBACK_MS = 1000;

const FADE_MS = 150;

function isPaintedMessage(event: WebViewMessageEvent) {
  try {
    return JSON.parse(event.nativeEvent.data)?.type === 'sapphire:painted';
  } catch {
    return false;
  }
}

/**
 * A WebView covered by a themed loading view until its first page has
 * actually painted. `startInLoadingState` drops its cover on the native load
 * event, which can land before WebKit commits the first frame, so the
 * WebView's own white canvas flashes through in dark mode.
 */
export function LoadingWebView({
  ref,
  onMessage,
  onLoadEnd,
  onError,
  style,
  ...props
}: WebViewProps & { ref?: Ref<WebView> }) {
  const colors = useColors();
  const [painted, setPainted] = useState(false);
  const fallback = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(fallback.current), []);

  return (
    <View style={[{ flex: 1 }, style]}>
      <WebView
        ref={ref}
        {...props}
        injectedJavaScript={FIRST_PAINT_SCRIPT}
        onMessage={(event) => {
          if (isPaintedMessage(event)) {
            setPainted(true);
          } else {
            onMessage?.(event);
          }
        }}
        onLoadEnd={(event) => {
          clearTimeout(fallback.current);
          fallback.current = setTimeout(
            () => setPainted(true),
            LOAD_END_FALLBACK_MS,
          );
          onLoadEnd?.(event);
        }}
        onError={(event) => {
          setPainted(true);
          onError?.(event);
        }}
        style={{ flex: 1, backgroundColor: colors.background }}
      />
      <WebViewLoading visible={!painted} />
    </View>
  );
}

function WebViewLoading({ visible }: { visible: boolean }) {
  const colors = useColors();
  const opacity = useRef(new Animated.Value(1)).current;
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    if (visible) return;
    Animated.timing(opacity, {
      toValue: 0,
      duration: FADE_MS,
      useNativeDriver: true,
    }).start(() => setMounted(false));
  }, [visible, opacity]);

  if (!mounted) return null;

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        styles.container,
        { backgroundColor: colors.background, opacity },
      ]}
    >
      <ActivityIndicator />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
