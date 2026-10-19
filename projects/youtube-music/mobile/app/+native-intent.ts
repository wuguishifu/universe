import { getShareExtensionKey } from 'expo-share-intent';

/**
 * Sharing to the app opens it with a link expo-share-intent makes up, which isn't a route. Land on
 * the library instead; ShareIntentHandler then takes the shared link to the add screen.
 */
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}) {
  try {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) return '/';
    return path;
  } catch {
    return '/';
  }
}
