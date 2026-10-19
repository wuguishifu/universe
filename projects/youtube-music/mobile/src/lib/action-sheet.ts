import { ActionSheetIOS, Alert, Platform } from 'react-native';

export type SheetAction = {
  label: string;
  onPress: () => void;
  destructive?: boolean;
};

/** A native action sheet on iOS, an alert with buttons elsewhere. */
export function showActionSheet(title: string, actions: SheetAction[]) {
  if (Platform.OS === 'ios') {
    const destructiveButtonIndex = actions
      .map((a, i) => (a.destructive ? i : -1))
      .filter((i) => i !== -1);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options: [...actions.map((a) => a.label), 'Cancel'],
        cancelButtonIndex: actions.length,
        destructiveButtonIndex,
      },
      (index) => actions[index]?.onPress(),
    );
    return;
  }
  Alert.alert(title, undefined, [
    ...actions.map((a) => ({
      text: a.label,
      onPress: a.onPress,
      style: a.destructive ? ('destructive' as const) : ('default' as const),
    })),
    { text: 'Cancel', style: 'cancel' },
  ]);
}

/** Asks before doing something that can't be undone. */
export function confirm(
  title: string,
  message: string,
  action: string,
  onConfirm: () => void,
) {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: action, style: 'destructive', onPress: onConfirm },
  ]);
}
