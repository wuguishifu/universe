import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

import * as SapphireSsh from '@projects/sapphire-ssh';

import {
  connectTrustingChangedKeys,
  hostKeyNote,
  type SessionParams,
} from '../../modules/ssh/connect';
import {
  type KeyBarModifiers,
  KeyBar,
  type KeyPress,
} from '../../modules/ssh/key-bar';
import {
  applyModifiers,
  encodeKey,
  type Modifiers,
  NO_MODIFIERS,
} from '../../modules/ssh/keys';
import {
  parseTerminalMessage,
  TERMINAL_BACKGROUND,
  TERMINAL_HTML,
  terminalCall,
} from '../../modules/ssh/terminal-html';
import { showError } from '../../modules/vault/ui';

type Phase = 'starting' | 'open' | 'closed' | 'reconnecting';

const DIM = (text: string) => `\x1b[2m${text}\x1b[0m`;

export default function SshSessionScreen() {
  const params = useLocalSearchParams<SessionParams>();
  const insets = useSafeAreaInsets();
  const web = useRef<WebView>(null);

  // Reconnecting swaps in a new session; events and writes always go to the current one.
  const sessionId = useRef(params.sessionId);
  const size = useRef<{ cols: number; rows: number }>(undefined);
  /** Whether the current session's shell is running, so a reloaded page reattaches to it. */
  const shellStarted = useRef(false);
  const appCursor = useRef(false);
  const [phase, setPhase] = useState<Phase>('starting');
  const [title, setTitle] = useState(params.label);
  const [keyboardShown, setKeyboardShown] = useState(false);

  const [modifiers, setModifiersState] = useState<KeyBarModifiers>({
    ctrl: 'off',
    alt: 'off',
  });
  const modifiersRef = useRef(modifiers);
  const setModifiers = (next: KeyBarModifiers) => {
    modifiersRef.current = next;
    setModifiersState(next);
  };

  const inject = (js: string) => web.current?.injectJavaScript(js);
  const printLocal = (text: string) =>
    inject(terminalCall('writeText', `\r\n${DIM(`[${text}]`)}\r\n`));

  useEffect(() => {
    const show = Keyboard.addListener('keyboardWillShow', () =>
      setKeyboardShown(true),
    );
    const hide = Keyboard.addListener('keyboardWillHide', () =>
      setKeyboardShown(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    const data = SapphireSsh.addDataListener((event) => {
      if (event.sessionId === sessionId.current) {
        inject(terminalCall('write', event.data));
      }
    });
    const close = SapphireSsh.addCloseListener((event) => {
      if (event.sessionId === sessionId.current) {
        shellStarted.current = false;
        setPhase('closed');
        printLocal(event.message ?? 'Session ended');
      }
    });
    return () => {
      data.remove();
      close.remove();
      SapphireSsh.close(sessionId.current);
    };
    // Once for the screen's lifetime; everything it reads is a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startShell = async () => {
    if (!size.current) {
      return;
    }
    try {
      await SapphireSsh.startShell(
        sessionId.current,
        size.current.cols,
        size.current.rows,
      );
      shellStarted.current = true;
      setPhase('open');
      inject(terminalCall('focus'));
    } catch (error) {
      setPhase('closed');
      printLocal(SapphireSsh.errorMessage(error));
    }
  };

  /** The armed modifiers for this key press; `once` ones turn off. */
  const consumeModifiers = (): Modifiers => {
    const current = modifiersRef.current;
    if (current.ctrl === 'once' || current.alt === 'once') {
      setModifiers({
        ctrl: current.ctrl === 'once' ? 'off' : current.ctrl,
        alt: current.alt === 'once' ? 'off' : current.alt,
      });
    }
    return { ctrl: current.ctrl !== 'off', alt: current.alt !== 'off' };
  };

  const send = (text: string) => {
    if (text) {
      SapphireSsh.write(sessionId.current, text);
    }
  };

  const onKeyBar = (press: KeyPress) => {
    const mods = consumeModifiers();
    send(
      press.kind === 'key'
        ? encodeKey(press.key, mods, appCursor.current)
        : applyModifiers(press.text, mods),
    );
  };

  const onModifier = (name: 'ctrl' | 'alt', action: 'tap' | 'lock') => {
    const current = modifiersRef.current[name];
    setModifiers({
      ...modifiersRef.current,
      [name]: action === 'lock' ? 'locked' : current === 'off' ? 'once' : 'off',
    });
  };

  const paste = async () => {
    try {
      const text = await SapphireSsh.pasteboardString();
      if (text) {
        // Back out through the page's onData, wrapped for bracketed paste if the app wants it.
        inject(terminalCall('paste', text));
      }
    } catch (error) {
      showError("Couldn't paste", error);
    }
  };

  const reconnect = useCallback(async () => {
    setPhase('reconnecting');
    try {
      const profiles = await SapphireSsh.listProfiles();
      const profile = profiles.find((p) => p.id === params.profileId);
      if (!profile) {
        throw new Error('This machine isn’t saved anymore.');
      }
      const connection = await connectTrustingChangedKeys(
        () => SapphireSsh.connectProfile(profile.id),
        profile,
      );
      if (!connection) {
        setPhase('closed');
        return;
      }
      sessionId.current = connection.sessionId;
      const note = hostKeyNote(connection);
      printLocal(note ? `Reconnected. ${note}` : 'Reconnected');
      await startShell();
    } catch (error) {
      setPhase('closed');
      printLocal(SapphireSsh.errorMessage(error));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.profileId]);

  return (
    <SafeAreaView
      edges={['top']}
      style={{ flex: 1, backgroundColor: TERMINAL_BACKGROUND }}
    >
      <View style={styles.header}>
        <Pressable hitSlop={12} onPress={() => router.back()}>
          <ChevronLeft color="#e6e6e6" />
        </Pressable>
        <Text numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        {phase === 'starting' || phase === 'reconnecting' ? (
          <ActivityIndicator color="#e6e6e6" />
        ) : phase === 'closed' ? (
          <Pressable hitSlop={12} onPress={() => void reconnect()}>
            <Text style={styles.reconnect}>Reconnect</Text>
          </Pressable>
        ) : null}
      </View>

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <WebView
          ref={web}
          source={{ html: TERMINAL_HTML }}
          originWhitelist={['*']}
          style={{ flex: 1, backgroundColor: TERMINAL_BACKGROUND }}
          // Let the page raise the keyboard itself (after the shell starts, and on tap).
          keyboardDisplayRequiresUserAction={false}
          // The form assistant bar (‹ › Done) would sit between the keyboard and the key bar.
          hideKeyboardAccessoryView
          scrollEnabled={false}
          bounces={false}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          dataDetectorTypes="none"
          allowsLinkPreview={false}
          // iOS kills WebView content processes under memory pressure, usually in the
          // background. Reload; the shell keeps running and the new page reattaches.
          onContentProcessDidTerminate={() => web.current?.reload()}
          onMessage={(event) => {
            const message = parseTerminalMessage(event.nativeEvent.data);
            switch (message?.type) {
              case 'ready':
                size.current = { cols: message.cols, rows: message.rows };
                if (shellStarted.current) {
                  // The page reloaded under a running shell; the scrollback is gone, the
                  // session isn't.
                  SapphireSsh.resize(
                    sessionId.current,
                    message.cols,
                    message.rows,
                  );
                  printLocal('Terminal reloaded');
                  SapphireSsh.write(sessionId.current, '\x0c');
                  break;
                }
                if (params.hostKeyNote) {
                  inject(
                    terminalCall('writeText', `${DIM(params.hostKeyNote)}\r\n`),
                  );
                }
                void startShell();
                break;
              case 'resize':
                size.current = { cols: message.cols, rows: message.rows };
                SapphireSsh.resize(
                  sessionId.current,
                  message.cols,
                  message.rows,
                );
                break;
              case 'input':
                send(applyModifiers(message.data, consumeModifiers()));
                break;
              case 'scrollKeys':
                send(
                  encodeKey(
                    message.key,
                    NO_MODIFIERS,
                    appCursor.current,
                  ).repeat(message.count),
                );
                break;
              case 'mode':
                appCursor.current = message.appCursor;
                break;
              case 'title':
                setTitle(message.title || params.label);
                break;
            }
          }}
        />
        <KeyBar
          modifiers={modifiers}
          onModifier={onModifier}
          onPress={onKeyBar}
          onPaste={() => void paste()}
          onHideKeyboard={() => inject(terminalCall('blur'))}
        />
        <View
          style={{
            height: keyboardShown ? 0 : insets.bottom,
            backgroundColor: '#16191e',
          }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  title: {
    flex: 1,
    color: '#e6e6e6',
    fontWeight: '600',
  },
  reconnect: {
    color: '#0a84ff',
  },
});
