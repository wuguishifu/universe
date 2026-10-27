import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { useColors } from '../theme';

/**
 * Covers a WebView until its first page finishes loading, so it doesn't flash
 * white before the page paints. Pass to `renderLoading` with
 * `startInLoadingState`.
 */
export function WebViewLoading() {
  const colors = useColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
