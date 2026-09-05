// Platform exports keep Compose out of the iOS render tree.
import { View } from 'react-native';
import type { Action, ButtonProps, ContextMenuProps, FieldProps, IconButtonProps, RowProps, DialogProps } from './MaterialUI.types';
export type { Action } from './MaterialUI.types';
export function MaterialButton(_props: ButtonProps) { return null; }
export function MaterialIconButton(_props: IconButtonProps) { return null; }
export function MaterialField(_props: FieldProps) { return null; }
export function MaterialSwitch(_props: {label: string; value: boolean; onChange: (value: boolean) => void}) { return null; }
export function MaterialSegmented<T extends string>(_props: {options: readonly {value: T; label: string}[]; value: T; onChange: (value: T) => void}) { return null; }
export function MaterialDialog(_props: DialogProps) { return null; }
export function MaterialRow(_props: RowProps) { return null; }
export function MaterialMenu(_props: {label: string; icon: string; actions: Action[]; text?: string; compact?: boolean}) { return null; }
export function MaterialLoading() { return null; }
export function MaterialContextMenu({ children, style }: ContextMenuProps) { return <View style={style}>{children}</View>; }
export function MaterialOverlays() { return null; }
