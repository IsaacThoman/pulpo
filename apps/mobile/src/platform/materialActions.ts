import { Alert } from 'react-native';
import type { Action, MenuAnchor, PromptOptions } from './MaterialUI.types';
export function showActions(title: string, actions: Action[], _anchor?: MenuAnchor) { Alert.alert(title, undefined, actions.map((action) => ({text: action.label, onPress: action.onPress}))); }
export function promptText(options: PromptOptions) { Alert.prompt(options.title, options.message, options.onSubmit, 'plain-text', options.value); }

export function selectText(text: string) { Alert.alert('Select text', text); }
