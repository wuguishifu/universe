import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ClipboardPaste,
  Ellipsis,
  KeyboardOff,
  Lock,
} from 'lucide-react-native';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ALT_CHORDS, CTRL_CHORDS, type SpecialKey, SYMBOLS } from './keys';

/** `once` applies to the next key, then turns off; `locked` stays until tapped again. */
export type ModifierState = 'off' | 'once' | 'locked';

export type KeyBarModifiers = { ctrl: ModifierState; alt: ModifierState };

export type KeyPress =
  | { kind: 'key'; key: SpecialKey }
  /** Goes through the armed modifiers, same as a character typed on the iOS keyboard. */
  | { kind: 'text'; text: string };

const REPEAT_DELAY_MS = 350;
const REPEAT_INTERVAL_MS = 60;

const COLORS = {
  bar: '#16191e',
  key: '#2a2f37',
  keyPressed: '#3d4450',
  armed: '#0a84ff',
  text: '#e6e6e6',
  muted: '#8b929c',
};

/**
 * The keys the iOS keyboard doesn't have, in one row above it:
 *
 * - **ctrl / alt** are sticky. Tap to arm for the next key (typed on the keyboard or on the bar),
 *   long-press to lock. While armed, a strip of common chords (^C, ^R, M-b, …) floats above the
 *   bar, so the usual ones are one tap.
 * - **arrows** repeat while held.
 * - **⋯** swaps the arrows for symbols, Home/End/PgUp/PgDn, paste and hide keyboard.
 */
export function KeyBar({
  modifiers,
  onModifier,
  onPress,
  onPaste,
  onHideKeyboard,
}: {
  modifiers: KeyBarModifiers;
  onModifier: (name: 'ctrl' | 'alt', action: 'tap' | 'lock') => void;
  onPress: (press: KeyPress) => void;
  onPaste: () => void;
  onHideKeyboard: () => void;
}) {
  const [extras, setExtras] = useState(false);
  const chords =
    modifiers.ctrl !== 'off'
      ? CTRL_CHORDS.map((c) => ({ ...c, prefix: '^' }))
      : modifiers.alt !== 'off'
        ? ALT_CHORDS.map((c) => ({ ...c, prefix: 'M-' }))
        : null;

  return (
    <View>
      {chords && (
        // Floats over the terminal instead of taking layout space, so arming ctrl doesn't resize
        // the PTY.
        <View style={styles.chordStrip} pointerEvents="box-none">
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chordContent}
          >
            {chords.map((chord) => (
              <Key
                key={chord.label}
                onPress={() =>
                  onPress({ kind: 'text', text: chord.label.toLowerCase() })
                }
                style={styles.chord}
              >
                <Text style={styles.keyText}>
                  {chord.prefix}
                  {chord.label}
                </Text>
                <Text style={styles.hint}>{chord.hint}</Text>
              </Key>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={styles.bar}>
        <Key onPress={() => onPress({ kind: 'key', key: 'Escape' })}>
          <Text style={styles.keyText}>esc</Text>
        </Key>
        <ModifierKey
          label="ctrl"
          state={modifiers.ctrl}
          onTap={() => onModifier('ctrl', 'tap')}
          onLock={() => onModifier('ctrl', 'lock')}
        />
        <ModifierKey
          label="alt"
          state={modifiers.alt}
          onTap={() => onModifier('alt', 'tap')}
          onLock={() => onModifier('alt', 'lock')}
        />
        <Key onPress={() => onPress({ kind: 'key', key: 'Tab' })}>
          <Text style={styles.keyText}>tab</Text>
        </Key>

        {extras ? (
          <ScrollView
            horizontal
            keyboardShouldPersistTaps="always"
            showsHorizontalScrollIndicator={false}
            style={{ flex: 4 }}
            contentContainerStyle={styles.extras}
          >
            <Key onPress={onPaste} style={styles.extraKey}>
              <ClipboardPaste size={16} color={COLORS.text} />
            </Key>
            <Key onPress={onHideKeyboard} style={styles.extraKey}>
              <KeyboardOff size={16} color={COLORS.text} />
            </Key>
            {(['Home', 'End', 'PageUp', 'PageDown', 'Delete'] as const).map(
              (key) => (
                <Key
                  key={key}
                  onPress={() => onPress({ kind: 'key', key })}
                  style={styles.extraKey}
                >
                  <Text style={styles.smallKeyText}>
                    {
                      {
                        Home: 'home',
                        End: 'end',
                        PageUp: 'pgup',
                        PageDown: 'pgdn',
                        Delete: 'del',
                      }[key]
                    }
                  </Text>
                </Key>
              ),
            )}
            {SYMBOLS.map((symbol) => (
              <Key
                key={symbol}
                onPress={() => onPress({ kind: 'text', text: symbol })}
                style={styles.extraKey}
              >
                <Text style={styles.keyText}>{symbol}</Text>
              </Key>
            ))}
          </ScrollView>
        ) : (
          <>
            <RepeatKey
              onPress={() => onPress({ kind: 'key', key: 'ArrowLeft' })}
            >
              <ArrowLeft size={16} color={COLORS.text} />
            </RepeatKey>
            <RepeatKey
              onPress={() => onPress({ kind: 'key', key: 'ArrowDown' })}
            >
              <ArrowDown size={16} color={COLORS.text} />
            </RepeatKey>
            <RepeatKey onPress={() => onPress({ kind: 'key', key: 'ArrowUp' })}>
              <ArrowUp size={16} color={COLORS.text} />
            </RepeatKey>
            <RepeatKey
              onPress={() => onPress({ kind: 'key', key: 'ArrowRight' })}
            >
              <ArrowRight size={16} color={COLORS.text} />
            </RepeatKey>
          </>
        )}
        <Key
          onPress={() => setExtras((e) => !e)}
          active={extras}
          accessibilityLabel={extras ? 'Show arrow keys' : 'Show more keys'}
        >
          <Ellipsis size={16} color={COLORS.text} />
        </Key>
      </View>
    </View>
  );
}

function Key({
  children,
  onPress,
  onPressIn,
  onPressOut,
  onLongPress,
  active,
  style,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress?: () => void;
  onPressIn?: () => void;
  onPressOut?: () => void;
  onLongPress?: () => void;
  active?: boolean;
  style?: object;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onLongPress={onLongPress}
      delayLongPress={400}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.key,
        {
          backgroundColor: active
            ? COLORS.armed
            : pressed
              ? COLORS.keyPressed
              : COLORS.key,
        },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}

function ModifierKey({
  label,
  state,
  onTap,
  onLock,
}: {
  label: string;
  state: ModifierState;
  onTap: () => void;
  onLock: () => void;
}) {
  return (
    <Key
      onPress={onTap}
      onLongPress={onLock}
      active={state !== 'off'}
      accessibilityLabel={`${label}${state === 'locked' ? ', locked' : state === 'once' ? ', armed' : ''}`}
    >
      <View style={styles.modifier}>
        <Text style={styles.keyText}>{label}</Text>
        {state === 'locked' && <Lock size={9} color={COLORS.text} />}
      </View>
    </Key>
  );
}

/** Fires on press, then repeats while held. */
function RepeatKey({
  children,
  onPress,
}: {
  children: ReactNode;
  onPress: () => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(onPress);
  latest.current = onPress;

  const stop = () => {
    clearTimeout(timer.current);
    clearInterval(timer.current);
  };
  useEffect(() => stop, []);

  return (
    <Key
      onPressIn={() => {
        latest.current();
        timer.current = setTimeout(() => {
          timer.current = setInterval(
            () => latest.current(),
            REPEAT_INTERVAL_MS,
          );
        }, REPEAT_DELAY_MS);
      }}
      onPressOut={stop}
    >
      {children}
    </Key>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 4,
    paddingVertical: 4,
    backgroundColor: COLORS.bar,
  },
  key: {
    flex: 1,
    height: 36,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: {
    color: COLORS.text,
    fontFamily: 'Menlo',
    fontSize: 13,
  },
  smallKeyText: {
    color: COLORS.text,
    fontFamily: 'Menlo',
    fontSize: 11,
  },
  modifier: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  extras: {
    gap: 4,
  },
  extraKey: {
    flex: 0,
    minWidth: 36,
    paddingHorizontal: 8,
  },
  chordStrip: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    right: 0,
    backgroundColor: 'rgba(22, 25, 30, 0.94)',
  },
  chordContent: {
    gap: 4,
    padding: 4,
  },
  chord: {
    flex: 0,
    height: 44,
    paddingHorizontal: 10,
  },
  hint: {
    color: COLORS.muted,
    fontSize: 9,
  },
});
