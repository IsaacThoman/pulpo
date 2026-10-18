// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({ onMove: vi.fn(), onOther: vi.fn(), alert: vi.fn() }));
vi.mock('../theme', () => ({ useAppTheme: () => ({ text: '#111', background: '#fff', separator: '#ddd', secondary: '#666', blue: '#00f', red: '#f00' }) }));
vi.mock('react-native', () => {
  const container = ({ children }: { children?: ReactNode }) => createElement('div', null, children);
  return {
    Alert: { alert: actions.alert }, Platform: { OS: 'ios' },
    Modal: container, SafeAreaView: container, KeyboardAvoidingView: container, ScrollView: container, View: container, Text: container,
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    Pressable: ({ children, onPress, disabled, accessibilityLabel }: { children: ReactNode; onPress: () => void; disabled?: boolean; accessibilityLabel: string }) => createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel }, children),
    TextInput: ({ value, onChangeText, accessibilityLabel }: { value: string; onChangeText: (text: string) => void; accessibilityLabel: string }) => createElement('input', { value, onChange: (event: { target: { value: string } }) => onChangeText(event.target.value), 'aria-label': accessibilityLabel }),
  };
});
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children: ReactNode }) => createElement('div', null, children) }));
import { MoveToFolderSheet } from './MoveToFolderSheet';

let root: Root;
let host: HTMLDivElement;
const folders = Array.from({ length: 12 }, (_, i) => ({ id: `f${i + 1}`, name: `Folder ${i + 1}`, depth: i % 2 }));
const onClose = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); });
function render(folderId: string | null, options: { disabledIds?: ReadonlySet<string>; other?: boolean } = {}) {
  act(() => root.render(<MoveToFolderSheet folderId={folderId} folders={folders} disabledIds={options.disabledIds} onMove={actions.onMove} onOther={options.other ? actions.onOther : undefined} onClose={onClose} />));
}
function click(label: string) {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(button).not.toBeNull();
  act(() => button!.click());
}
function input(label: string, value: string) {
  const field = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('searches and moves to a folder beyond the first three', () => {
  render(null);
  input('Search folders', 'folder 12');
  expect(host.querySelector('button[aria-label="Folder 1"]')).toBeNull();
  click('Folder 12');
  expect(actions.onMove).toHaveBeenCalledWith('f12');
  expect(onClose).toHaveBeenCalledOnce();
});
it('keeps No folder available even with a search and moves outside folders', () => {
  render('f12');
  input('Search folders', 'missing');
  click('No folder');
  expect(actions.onMove).toHaveBeenCalledWith(null);
});
it('cancels without moving', () => {
  render('f12');
  click('Cancel');
  expect(onClose).toHaveBeenCalledOnce();
  expect(actions.onMove).not.toHaveBeenCalled();
});
it('does not move a folder into itself or the folders inside it', () => {
  render(null, { disabledIds: new Set(['f2', 'f3']) });
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="Folder 2"]')!.disabled).toBe(true);
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="Folder 4"]')!.disabled).toBe(false);
});
it('browses Files for another folder once closed', () => {
  render(null, { other: true });
  click('Other folder…');
  expect(onClose).toHaveBeenCalledOnce();
  expect(actions.onOther).toHaveBeenCalledOnce();
  expect(actions.onMove).not.toHaveBeenCalled();
});
