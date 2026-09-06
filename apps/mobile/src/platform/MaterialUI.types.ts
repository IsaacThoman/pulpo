import type { ReactNode, Ref } from 'react';
import type { ColorValue, ImageSourcePropType, StyleProp, TextInputProps, ViewStyle } from 'react-native';
export type Action = { id?: string; image?: ImageSourcePropType; keepOpen?: boolean; submenu?: { title: string; actions: Action[] }; label: string; icon?: string; onPress: () => void; destructive?: boolean; disabled?: boolean; selected?: boolean; detail?: string };
export type ButtonProps = { label: string; icon?: string; onPress: () => void; disabled?: boolean; loading?: boolean; variant?: 'primary' | 'secondary' | 'destructive' | 'plain'; compact?: boolean };
export type IconButtonProps = { label: string; icon: string; onPress: () => void; disabled?: boolean; selected?: boolean; prominent?: boolean; size?: number; color?: ColorValue; containerColor?: ColorValue };
export type FieldProps = TextInputProps & { label?: string; error?: string; icon?: string; trailingAction?: { label: string; icon: string; onPress: () => void } };
export type DialogProps = { visible: boolean; title: string; onClose: () => void; children: ReactNode; contentHeight?: number; fullScreen?: boolean };
export type RowProps = { title: string; detail?: string; detailLines?: number; value?: string; image?: ImageSourcePropType; icon?: string; destructive?: boolean; selected?: boolean; onPress?: () => void };
export type ContextMenuProps = { children: ReactNode; title: string; actions: Action[]; style?: StyleProp<ViewStyle> };
export type PromptOptions = { title: string; message?: string; value?: string; multiline?: boolean; confirmLabel?: string; onSubmit: (value: string) => void };

export type MenuAnchor = { x: number; y: number };

export type MenuSection = { id: string; title?: string; actions: Action[] };
export type MenuProps = { label: string; icon: string; actions?: Action[]; sections?: MenuSection[]; text?: string; compact?: boolean; image?: ImageSourcePropType; centered?: boolean };

export type SuggestionButtonProps = { label: string; onPress: () => void; fullWidth?: boolean; temporary?: boolean };
export type CardProps = { children: ReactNode; style?: StyleProp<ViewStyle> };
export type SearchFieldProps = { value: string; onChange: (value: string) => void; onFocusChange: (focused: boolean) => void; fieldRef?: Ref<{ blur: () => Promise<void> }> };
export type NavigationRowProps = { title: string; icon?: string; value?: string; expanded?: boolean; onPress: () => void };
