import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { cacheNamespace } from '../../../data/schema';
import { signupPromoClaimLabel, signupPromoSuccessLabel, useSignupPromo } from '../../../features/signup-promo/useSignupPromo';
import { SymbolView } from '../../../platform/SymbolView';
import { useSessionStore } from '../../../store/session';
import { useAppTheme } from '../theme';

const snoozedNamespaces = new Set<string>();

export function SignupPromoBanner() {
  const namespace = useSessionStore((state) => state.user ? cacheNamespace(state.instanceUrl, state.user.id) : null);
  return namespace ? <PromoCard key={namespace} namespace={namespace} /> : null;
}

function PromoCard({ namespace }: { namespace: string }) {
  const theme = useAppTheme();
  const [snoozed, setSnoozed] = useState(() => snoozedNamespaces.has(namespace));
  const [confirmationVisible, setConfirmationVisible] = useState(true);
  const { offer, claim, receipt, pending } = useSignupPromo(!snoozed, true);
  useEffect(() => {
    if (!receipt) return;
    const timer = setTimeout(() => setConfirmationVisible(false), 4_000);
    return () => clearTimeout(timer);
  }, [receipt]);

  const card = [styles.banner, { backgroundColor: theme.fillStrong }];
  if (receipt) {
    return confirmationVisible ? <View style={card}>
      <Text accessibilityLiveRegion="polite" style={[styles.message, { color: theme.text }]}>{signupPromoSuccessLabel(receipt.amountCents)}</Text>
    </View> : null;
  }
  if (!offer) return null;
  return (
    <View style={card}>
      <Text style={[styles.message, styles.copy, { color: theme.text }]}>{offer.message || 'Welcome to Pulpo!'}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: pending, busy: pending }}
        disabled={pending}
        onPress={() => claim(offer.amountCents)}
        style={({ pressed }) => [styles.button, { backgroundColor: theme.accent, opacity: pending || pressed ? 0.7 : 1 }]}
      >
        <Text style={[styles.buttonText, { color: theme.accentText }]}>{signupPromoClaimLabel(offer.amountCents, pending)}</Text>
      </Pressable>
      <Pressable
        accessibilityLabel="Remind me later"
        accessibilityRole="button"
        disabled={pending}
        onPress={() => { snoozedNamespaces.add(namespace); setSnoozed(true); }}
        style={styles.dismiss}
      >
        <SymbolView name="xmark" size={13} tintColor={theme.secondary} weight="semibold" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { alignItems: 'center', gap: 6, borderRadius: 12, padding: 8, marginBottom: 8 },
  message: { textAlign: 'center', fontSize: 14 },
  copy: { paddingHorizontal: 36 },
  button: { minHeight: 44, justifyContent: 'center', borderRadius: 8, paddingHorizontal: 12 },
  buttonText: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  dismiss: { position: 'absolute', top: 0, right: 0, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
