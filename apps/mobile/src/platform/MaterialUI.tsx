// Platform exports keep Compose out of the iOS render tree.
import { View } from 'react-native';
import type { ButtonProps, CardProps, SearchFieldProps, SuggestionButtonProps, NavigationRowProps, ContextMenuProps, FieldProps, IconButtonProps, RowProps, DialogProps, MenuProps } from './MaterialUI.types';
export type { Action } from './MaterialUI.types';
export function MaterialButton(_props: ButtonProps) { return null; }
export function MaterialIconButton(_props: IconButtonProps) { return null; }
export function MaterialField(_props: FieldProps) { return null; }
export function MaterialSwitch(_props: {label: string; value: boolean; onChange: (value: boolean) => void}) { return null; }
export function MaterialSegmented<T extends string>(_props: {options: readonly {value: T; label: string}[]; value: T; onChange: (value: T) => void}) { return null; }
export function MaterialDialog(_props: DialogProps) { return null; }
export function MaterialRow(_props: RowProps) { return null; }
export function MaterialMenu(_props: MenuProps) { return null; }
export function MaterialLoading() { return null; }
export function MaterialContextMenu({ children, style }: ContextMenuProps) { return <View style={style}>{children}</View>; }
export function MaterialOverlays() { return null; }

export function MaterialSuggestionButton(_props: SuggestionButtonProps) { return null; }
export function MaterialSearchField(_props: SearchFieldProps) { return null; }
export function MaterialCard({ children, style }: CardProps) { return <View style={style}>{children}</View>; }
export function MaterialNavigationRow(_props: NavigationRowProps) { return null; }

export function MaterialToggleRow(_props: { title: string; detail?: string; value: boolean; onChange: (value: boolean) => void }) { return null; }
