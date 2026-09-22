import { activeModelWarning, dismissModelWarning, modelLinkTarget, unlinkUnavailableModelLinks } from '@pulpo/client-core';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeMarkdown } from '../../../components/SafeMarkdown';
import { SymbolView } from '../../../platform/SymbolView';
import type { PrototypeModel } from '../domain';
import { usePrototypeStore } from '../store/prototypeStore';
import { useAppTheme } from '../theme';

/** Admin-configured notice for the selected model, dismissible per account. */
export function ModelWarningBanner({ model, onSelectModel }: {
  model: PrototypeModel | undefined;
  /** Switches the composer when a `model:` link is tapped. */
  onSelectModel?: (modelId: string) => void;
}) {
  const theme = useAppTheme();
  const enabled = usePrototypeStore((state) => state.preferences.showModelWarnings);
  const dismissals = usePrototypeStore((state) => state.preferences.modelWarningDismissals);
  const models = usePrototypeStore((state) => state.models);
  const message = activeModelWarning(model, dismissals, { enabled });
  if (!model || !message) return null;
  const isModelAvailable = (id: string) => Boolean(onSelectModel) && id !== model.id && models.some((candidate) => candidate.id === id && candidate.enabled);
  const pressLink = (url: string) => {
    const target = modelLinkTarget(url);
    if (!target) return false;
    if (isModelAvailable(target)) onSelectModel?.(target);
    return true;
  };
  const dismiss = () => {
    const state = usePrototypeStore.getState();
    state.setPreference('modelWarningDismissals', dismissModelWarning(state.preferences.modelWarningDismissals, model, state.models));
  };
  return (
    <View accessibilityRole="summary" style={[styles.banner, { backgroundColor: theme.fillStrong }]}>
      <View style={styles.message}>
        <SafeMarkdown compact selectable={false} onLinkPress={pressLink}>{unlinkUnavailableModelLinks(message, isModelAvailable)}</SafeMarkdown>
      </View>
      <Pressable
        accessibilityLabel="Dismiss warning"
        accessibilityRole="button"
        hitSlop={8}
        onPress={dismiss}
        style={styles.dismiss}
      >
        <SymbolView name="xmark" size={14} tintColor={theme.secondary} weight="semibold" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderRadius: 14, paddingLeft: 12, paddingRight: 6, paddingVertical: 8, marginBottom: 8 },
  message: { flex: 1, minWidth: 0, paddingTop: 2 },
  dismiss: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
});
