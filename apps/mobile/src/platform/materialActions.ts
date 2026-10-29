import { Alert, type AlertButton } from 'react-native';
import type { Action, MenuAnchor, PromptOptions } from './MaterialUI.types';
export function showActions(title: string, actions: Action[], _anchor?: MenuAnchor) { Alert.alert(title, undefined, actions.map((action) => ({text: action.label, onPress: action.onPress}))); }
export function promptText(options: PromptOptions) {
  const buttons: AlertButton[] | ((value: string) => void) = options.confirmLabel
    ? [{ text: 'Cancel', style: 'cancel' }, { text: options.confirmLabel, isPreferred: true, onPress: (value?: string) => options.onSubmit(value ?? '') }]
    : options.onSubmit;
  Alert.prompt(options.title, options.message, buttons, 'plain-text', options.value);
}

export function selectText(text: string) { Alert.alert('Select text', text); }
