import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Keyboard, KeyboardAvoidingView, Modal, Pressable, ScrollView, Text as RNText, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  AlertDialog, Button, Column, DropdownMenu, DropdownMenuItem, FilledIconButton,
  FilledTonalButton, FilledTonalIconButton, Host, Icon, IconButton, ListItem,
  LoadingIndicator, OutlinedTextField, RNHostView,
  SegmentedButton, SingleChoiceSegmentedButtonRow, Switch, Text, TextButton,
  useMaterialColors, useNativeState,
} from '@expo/ui/jetpack-compose';
import { clickable, defaultMinSize, fillMaxWidth, height, padding, semantics, size, verticalScroll, weight, width } from '@expo/ui/jetpack-compose/modifiers';
import { getMaterialOverlay, showActions, subscribe, update } from './materialActions.android';
import { androidDialogBodyHeight } from './androidLayout';
import { materialTint } from './materialTint';
import { materialIcon } from './materialIcons';
import type { Action, ButtonProps, ContextMenuProps, FieldProps, IconButtonProps, PromptOptions, RowProps, DialogProps } from './MaterialUI.types';
export type { Action } from './MaterialUI.types';

export function MaterialButton({ label, icon, onPress, disabled, loading, variant = 'primary', compact }: ButtonProps) {
  const colors = useMaterialColors();
  const Component = variant === 'plain' ? TextButton : variant === 'secondary' ? FilledTonalButton : Button;
  return <Host matchContents={{ vertical: true }} style={compact ? { minWidth: 124 } : { width: '100%' }} ignoreSafeAreaKeyboardInsets>
    <Component enabled={!disabled && !loading} onClick={onPress} modifiers={[fillMaxWidth(), defaultMinSize({ minHeight: 52 })]}
      colors={variant === 'destructive' ? { containerColor: colors.errorContainer, contentColor: colors.onErrorContainer } : undefined}>
      {loading ? <LoadingIndicator modifiers={[size(24, 24)]} /> : icon ? <Icon source={materialIcon(icon)} size={20} modifiers={[padding(0, 0, 8, 0)]} /> : null}
      <Text style={{ textAlign: 'center' }} modifiers={[weight(1)]}>{label}</Text>
    </Component>
  </Host>;
}

export function MaterialIconButton({ label, icon, onPress, disabled, selected, prominent, size: requestedSize = 48, color }: IconButtonProps) {
  const colors = useMaterialColors();
  const dimension = Math.max(48, requestedSize);
  const Component = prominent ? FilledIconButton : selected ? FilledTonalIconButton : IconButton;
  return <Host style={{ width: dimension, height: dimension }} ignoreSafeAreaKeyboardInsets>
    <Component enabled={!disabled} onClick={onPress} colors={!prominent && !selected ? { contentColor: colors.onSurface, disabledContentColor: colors.outline } : undefined} modifiers={[size(dimension, dimension)]}>
      <Icon source={materialIcon(icon)} size={24} contentDescription={label} tint={materialTint(color, colors)} />
    </Component>
  </Host>;
}

export function MaterialField({ label, error, icon, trailingAction, ...props }: FieldProps) {
  const value = useNativeState(String(props.value ?? ''));
  const lastNativeText = useRef(String(props.value ?? ''));
  useEffect(() => {
    const next = String(props.value ?? '');
    if (next !== lastNativeText.current) { lastNativeText.current = next; value.set(next); }
  }, [value, props.value]);
  const onValueChange = (next: string) => { lastNativeText.current = next; props.onChangeText?.(next); };
  const keyboardType = props.secureTextEntry ? 'password' : props.keyboardType === 'email-address' ? 'email' : props.keyboardType === 'url' ? 'uri' : props.keyboardType === 'number-pad' || props.keyboardType === 'numeric' ? 'number' : props.keyboardType === 'phone-pad' ? 'phone' : 'text';
  const submit = () => props.onSubmitEditing?.({ nativeEvent: { text: value.get() } } as never);
  return <Host matchContents={{ vertical: true }} style={{ width: '100%' }} ignoreSafeAreaKeyboardInsets>
    <OutlinedTextField value={value} onValueChange={onValueChange} enabled={props.editable !== false} autoFocus={props.autoFocus}
      singleLine={!props.multiline} minLines={props.multiline ? 4 : 1} maxLines={props.multiline ? 8 : 1} maxLength={props.maxLength}
      isError={Boolean(error)} visualTransformation={props.secureTextEntry ? 'password' : 'none'} modifiers={[fillMaxWidth(), semantics({ contentType: props.autoComplete })]}
      keyboardOptions={{ keyboardType, capitalization: props.autoCapitalize === 'none' ? 'none' : props.autoCapitalize ?? 'sentences', autoCorrectEnabled: props.autoCorrect !== false, imeAction: props.returnKeyType === 'go' ? 'go' : props.returnKeyType === 'search' ? 'search' : props.returnKeyType === 'next' ? 'next' : 'done' }}
      keyboardActions={{ onDone: submit, onGo: submit, onSearch: submit, onNext: submit }}>
      <OutlinedTextField.Label><Text>{label ?? props.accessibilityLabel ?? props.placeholder ?? ''}</Text></OutlinedTextField.Label>
      {props.placeholder ? <OutlinedTextField.Placeholder><Text>{props.placeholder}</Text></OutlinedTextField.Placeholder> : null}
      {icon ? <OutlinedTextField.LeadingIcon><Icon source={materialIcon(icon)} size={24} /></OutlinedTextField.LeadingIcon> : null}
      {trailingAction ? <OutlinedTextField.TrailingIcon><IconButton onClick={trailingAction.onPress}><Icon source={materialIcon(trailingAction.icon)} size={24} contentDescription={trailingAction.label} /></IconButton></OutlinedTextField.TrailingIcon> : null}
      {error ? <OutlinedTextField.SupportingText><Text>{error}</Text></OutlinedTextField.SupportingText> : null}
    </OutlinedTextField>
  </Host>;
}

export function MaterialSwitch({ label, value, onChange }: {label: string; value: boolean; onChange: (value: boolean) => void}) {
  return <View accessible accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }}
    accessibilityActions={[{ name: 'activate' }]} onAccessibilityAction={() => onChange(!value)} onAccessibilityTap={() => onChange(!value)}>
    <View importantForAccessibility="no-hide-descendants"><Host style={{ width: 56, height: 48 }}><Switch value={value} onCheckedChange={onChange}>
      <Switch.ThumbContent><Icon source={materialIcon(value ? 'checkmark' : 'xmark')} size={16} /></Switch.ThumbContent>
    </Switch></Host></View>
  </View>;
}

export function MaterialSegmented<T extends string>({ options, value, onChange }: {options: readonly {value: T; label: string}[]; value: T; onChange: (value: T) => void}) {
  return <Host matchContents={{ vertical: true }} style={{ width: '100%' }}><SingleChoiceSegmentedButtonRow modifiers={[fillMaxWidth()]}>
    {options.map((option) => <SegmentedButton key={option.value} selected={value === option.value} onClick={() => onChange(option.value)}><SegmentedButton.Label><Text>{option.label}</Text></SegmentedButton.Label></SegmentedButton>)}
  </SingleChoiceSegmentedButtonRow></Host>;
}

export function MaterialRow({ title, detail, detailLines, value, icon, destructive, selected, onPress }: RowProps) {
  const colors = useMaterialColors();
  const { fontScale, width: windowWidth } = useWindowDimensions();
  const stackedValue = Boolean(value && (value.length > 20 || fontScale >= 1.5 || windowWidth < 360));
  return <Host matchContents={{ vertical: true }} style={{ width: '100%' }}><ListItem modifiers={onPress ? [clickable(onPress)] : []}
    colors={{ containerColor: selected ? colors.secondaryContainer : colors.surfaceContainerLow, contentColor: destructive ? colors.error : colors.onSurface }}>
    <ListItem.HeadlineContent><Text>{title}</Text></ListItem.HeadlineContent>
    {detail || stackedValue ? <ListItem.SupportingContent><Text maxLines={detailLines} overflow="ellipsis">{[detail, stackedValue ? value : undefined].filter(Boolean).join('\n')}</Text></ListItem.SupportingContent> : null}
    {icon ? <ListItem.LeadingContent><Icon source={materialIcon(icon)} size={24} /></ListItem.LeadingContent> : null}
    {(value && !stackedValue) || selected ? <ListItem.TrailingContent>{selected ? <Icon source={materialIcon('checkmark')} size={24} /> : <Text>{value}</Text>}</ListItem.TrailingContent> : null}
  </ListItem></Host>;
}

export function MaterialMenu({ label, icon, actions, text, compact }: {label: string; icon: string; actions: Action[]; text?: string; compact?: boolean}) {
  const [expanded, setExpanded] = useState(false);
  const { width: windowWidth } = useWindowDimensions();
  const colors = useMaterialColors();
  return <Host style={{ width: text ? compact ? Math.min(200, Math.max(112, windowWidth - 216)) : 210 : 48, maxWidth: '100%', height: 48 }} ignoreSafeAreaKeyboardInsets><DropdownMenu expanded={expanded} onDismissRequest={() => setExpanded(false)}>
    <DropdownMenu.Trigger>{text ? <TextButton onClick={() => setExpanded(true)} modifiers={[fillMaxWidth(), height(48)]}><Text maxLines={1} overflow="ellipsis" modifiers={[weight(1)]}>{text}</Text><Icon source={materialIcon(icon)} size={16} contentDescription={label} modifiers={[padding(8, 0, 0, 0)]} /></TextButton> : <IconButton colors={{ contentColor: colors.onSurface }} onClick={() => setExpanded(true)}><Icon source={materialIcon(icon)} size={24} contentDescription={label} /></IconButton>}</DropdownMenu.Trigger>
    <DropdownMenu.Items><MenuItems actions={actions} onDismiss={() => setExpanded(false)} /></DropdownMenu.Items>
  </DropdownMenu></Host>;
}

// Short forms stay centered; searchable catalogs can use a full-screen page
// when the window or text size leaves too little room for a dialog.
export function MaterialDialog({ visible, title, onClose, children, contentHeight = 320, fullScreen }: DialogProps) {
  const { height: screenHeight, width: screenWidth, fontScale } = useWindowDimensions();
  const colors = useMaterialColors();
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => setKeyboardTop(event.endCoordinates.screenY));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardTop(null));
    return () => { show.remove(); hide.remove(); };
  }, []);
  if (!visible) return null;
  if (fullScreen) return <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent navigationBarTranslucent>
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}><SafeAreaView edges={['top', 'bottom']} style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingHorizontal: 8, gap: 8 }}>
        <MaterialIconButton label={`Close ${title.toLowerCase()}`} icon="arrow.left" onPress={onClose} />
        <RNText accessibilityRole="header" style={{ flex: 1, color: colors.onSurface, fontSize: 24, paddingVertical: 12 }}>{title}</RNText>
      </View>
      <View style={{ flex: 1, minHeight: 0, paddingHorizontal: 16, paddingBottom: 8 }}>{children}</View>
    </SafeAreaView></KeyboardAvoidingView>
  </Modal>;
  const dialogWidth = Math.min(screenWidth - 48, 560);
  return <Host style={{ position: 'absolute', width: 1, height: 1 }}><AlertDialog onDismissRequest={onClose} properties={{ usePlatformDefaultWidth: false }} modifiers={[width(dialogWidth)]}>
    <AlertDialog.Title><Text>{title}</Text></AlertDialog.Title>
    <AlertDialog.Text><RNHostView matchContents><View style={{ width: dialogWidth - 48, height: androidDialogBodyHeight(Math.min(screenHeight, keyboardTop ?? screenHeight), contentHeight * Math.min(fontScale, 1.5), fontScale) }}>{children}</View></RNHostView></AlertDialog.Text>
    <AlertDialog.ConfirmButton><TextButton onClick={onClose}><Text>Done</Text></TextButton></AlertDialog.ConfirmButton>
  </AlertDialog></Host>;
}
export function MaterialLoading() { return <Host style={{ width: 48, height: 48 }}><LoadingIndicator /></Host>; }

export function MaterialContextMenu({ title, actions, children, style }: ContextMenuProps) {
  const trigger = useRef<View>(null);
  const openForAccessibility = () => trigger.current?.measureInWindow((x, y, width, height) => showActions(title, actions, { x: x + width / 2, y: y + height / 2 }));
  return <Pressable ref={trigger} style={style} onLongPress={(event) => showActions(title, actions, { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY })} accessibilityActions={[{name: 'longpress', label: 'Show actions'}]} onAccessibilityAction={openForAccessibility}>{children}</Pressable>;
}
function MenuItems({ actions, onDismiss }: { actions: Action[]; onDismiss: () => void }) {
  const colors = useMaterialColors();
  return <>{actions.map((action) => <DropdownMenuItem key={action.label} enabled={!action.disabled} onClick={() => { onDismiss(); action.onPress(); }}>
    <DropdownMenuItem.Text><Text color={action.destructive ? colors.error : undefined}>{action.label}</Text></DropdownMenuItem.Text>
    {action.icon ? <DropdownMenuItem.LeadingIcon><Icon source={materialIcon(action.icon)} size={24} /></DropdownMenuItem.LeadingIcon> : null}
    {action.selected ? <DropdownMenuItem.TrailingIcon><Icon source={materialIcon('checkmark')} size={20} /></DropdownMenuItem.TrailingIcon> : null}
  </DropdownMenuItem>)}</>;
}

function Prompt({ options }: {options: PromptOptions}) {
  const [text, setText] = useState(options.value ?? '');
  const value = useNativeState(options.value ?? '');
  const submit = () => { const next = text.trim(); if (next) { update(null); options.onSubmit(next); } };
  return <AlertDialog onDismissRequest={() => update(null)}>
    <AlertDialog.Title><Text>{options.title}</Text></AlertDialog.Title>
    <AlertDialog.Text><Column>{options.message ? <Text>{options.message}</Text> : null}<OutlinedTextField value={value} onValueChange={setText} singleLine={!options.multiline} minLines={options.multiline ? 4 : 1} maxLines={options.multiline ? 10 : 1} modifiers={[fillMaxWidth()]}><OutlinedTextField.Label><Text>{options.multiline ? 'Message' : 'Name'}</Text></OutlinedTextField.Label></OutlinedTextField></Column></AlertDialog.Text>
    <AlertDialog.DismissButton><TextButton onClick={() => update(null)}><Text>Cancel</Text></TextButton></AlertDialog.DismissButton>
    <AlertDialog.ConfirmButton><TextButton enabled={Boolean(text.trim())} onClick={submit}><Text>{options.confirmLabel ?? 'Save'}</Text></TextButton></AlertDialog.ConfirmButton>
  </AlertDialog>;
}
export function MaterialOverlays() {
  const state = useSyncExternalStore(subscribe, getMaterialOverlay);
  const colors = useMaterialColors();
  if (!state) return null;
  const dismiss = () => update(null);
  if (state.kind === 'selection') return <MaterialDialog visible fullScreen title="Select text" onClose={dismiss}><ScrollView><RNText selectable style={{ color: colors.onSurface, fontSize: 16, lineHeight: 24, paddingBottom: 24 }}>{state.text}</RNText></ScrollView></MaterialDialog>;
  if (state.kind === 'actions' && state.anchor) return <Host key="anchored-actions" style={{ position: 'absolute', left: state.anchor.x, top: state.anchor.y, width: 1, height: 1 }} ignoreSafeAreaKeyboardInsets>
    <DropdownMenu expanded onDismissRequest={dismiss}>
      <DropdownMenu.Trigger><Column modifiers={[size(1, 1)]} /></DropdownMenu.Trigger>
      <DropdownMenu.Items><MenuItems actions={state.actions} onDismiss={dismiss} /></DropdownMenu.Items>
    </DropdownMenu>
  </Host>;
  // Separate host identities prevent Compose props from being reset to null when
  // React batches dismissal of an anchored menu with opening its prompt.
  return <Host key={state.kind} style={{ position: 'absolute', width: 1, height: 1 }} ignoreSafeAreaKeyboardInsets>{state.kind === 'prompt' ? <Prompt options={state.options} /> : <AlertDialog onDismissRequest={dismiss}>
    <AlertDialog.Title><Text>{state.title}</Text></AlertDialog.Title>
    <AlertDialog.Text><Column modifiers={[fillMaxWidth(), verticalScroll()]}>
      {state.actions.map((action) => <ListItem key={action.label} modifiers={action.disabled ? [] : [clickable(() => { dismiss(); action.onPress(); })]} colors={{ containerColor: colors.surfaceContainerHigh, contentColor: action.disabled ? colors.outline : action.destructive ? colors.error : colors.onSurface }}>
        <ListItem.HeadlineContent><Text>{action.label}</Text></ListItem.HeadlineContent>
        {action.icon ? <ListItem.LeadingContent><Icon source={materialIcon(action.icon)} size={24} /></ListItem.LeadingContent> : null}
        {action.selected ? <ListItem.TrailingContent><Icon source={materialIcon('checkmark')} size={24} /></ListItem.TrailingContent> : null}
      </ListItem>)}
    </Column></AlertDialog.Text>
    <AlertDialog.ConfirmButton><TextButton onClick={dismiss}><Text>Cancel</Text></TextButton></AlertDialog.ConfirmButton>
  </AlertDialog>}</Host>;
}
