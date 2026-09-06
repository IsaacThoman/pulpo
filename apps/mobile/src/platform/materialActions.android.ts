import { Keyboard } from 'react-native';
import type { Action, MenuAnchor, PromptOptions } from './MaterialUI.types';

// Anchored actions use a native popup; settings choices and prompts use dialogs.
// Clear before invoking an action so a menu can safely open another surface.
export type Overlay = { kind: 'actions'; title: string; actions: Action[]; anchor?: MenuAnchor } | { kind: 'selection'; text: string } | { kind: 'prompt'; options: PromptOptions } | null;
let overlay: Overlay = null;
const listeners = new Set<() => void>();
export function update(next: Overlay) { overlay = next; listeners.forEach((listener) => listener()); }
export function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function showActions(title: string, actions: Action[], anchor?: MenuAnchor) { Keyboard.dismiss(); update({kind: 'actions', title, actions, anchor}); }
export function promptText(options: PromptOptions) { Keyboard.dismiss(); update({kind: 'prompt', options}); }
export function getMaterialOverlay() { return overlay; }

export function selectText(text: string) { Keyboard.dismiss(); update({ kind: 'selection', text }); }
