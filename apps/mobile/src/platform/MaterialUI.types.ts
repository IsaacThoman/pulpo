import type { ReactNode } from 'react';
import type { ColorValue, StyleProp, TextInputProps, ViewStyle } from 'react-native';
export type Action = { label: string; icon?: string; onPress: () => void; destructive?: boolean; disabled?: boolean; selected?: boolean; detail?: string };
export type ButtonProps = { label: string; icon?: string; onPress: () => void; disabled?: boolean; loading?: boolean; variant?: 'primary' | 'secondary' | 'destructive' | 'plain'; compact?: boolean };
export type IconButtonProps = { label: string; icon: string; onPress: () => void; disabled?: boolean; selected?: boolean; prominent?: boolean; size?: number; color?: ColorValue };
export type FieldProps = TextInputProps & { label?: string; error?: string; icon?: string; trailingAction?: { label: string; icon: string; onPress: () => void } };
export type DialogProps = { visible: boolean; title: string; onClose: () => void; children: ReactNode; contentHeight?: number; fullScreen?: boolean };
export type RowProps = { title: string; detail?: string; detailLines?: number; value?: string; icon?: string; destructive?: boolean; selected?: boolean; onPress?: () => void };
export type ContextMenuProps = { children: ReactNode; title: string; actions: Action[]; style?: StyleProp<ViewStyle> };
export type PromptOptions = { title: string; message?: string; value?: string; multiline?: boolean; confirmLabel?: string; onSubmit: (value: string) => void };

export type MenuAnchor = { x: number; y: number };
