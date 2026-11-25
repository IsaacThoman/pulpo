import { SIGNUP_PROMO_CLAIM_MS, type SignupPromoAvailability, type SignupPromoReceipt } from '@pulpo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError, apiRequest } from '../../../api/client';
import { cacheNamespace } from '../../../data/schema';
import { SymbolView } from '../../../platform/SymbolView';
import { useSessionStore } from '../../../store/session';
import { useAppTheme } from '../theme';

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });
const SUCCESS_VISIBLE_MS = 4_000;
// "Later" hides the offer until the app restarts, so the credit is never lost to a stray tap.
const snoozedNamespaces = new Set<string>();

export function SignupPromoBanner() {
  const theme = useAppTheme();
  const user = useSessionStore((state) => state.user);
  const token = useSessionStore((state) => state.token);
  const instanceUrl = useSessionStore((state) => state.instanceUrl);
  const supported = useSessionStore((state) => state.config?.capabilities.signupPromo === true);
  const userId = user?.id;
  const expiresAt = user ? Date.parse(user.createdAt) + SIGNUP_PROMO_CLAIM_MS : 0;
  const namespace = userId ? cacheNamespace(instanceUrl, userId) : null;
  const queryKey = ['signup-promo', namespace];
  const queryClient = useQueryClient();
  const [snoozed, setSnoozed] = useState(() => Boolean(namespace && snoozedNamespaces.has(namespace)));
  const [claimedCents, setClaimedCents] = useState<number | null>(null);
  const availability = useQuery({
    queryKey,
    queryFn: ({ signal }) => apiRequest<SignupPromoAvailability>('/api/billing/signup-promo', { signal }),
    enabled: supported && !snoozed && Boolean(token && user && user.role !== 'pending' && expiresAt > Date.now()),
    refetchInterval: () => Date.now() < expiresAt ? 60_000 : false,
    retry: false,
  });
  const offer = availability.data?.userId === userId ? availability.data?.offer : null;
  const sessionIsCurrent = () => {
    const session = useSessionStore.getState();
    return session.instanceUrl === instanceUrl && session.token === token && session.user?.id === userId;
  };
  const claim = useMutation({
    mutationFn: (amountCents: number) => apiRequest<SignupPromoReceipt>('/api/billing/signup-promo/claim', {
      method: 'POST', body: { userId, amountCents },
    }),
    onSuccess: async (receipt) => {
      if (sessionIsCurrent()) setClaimedCents(receipt.amountCents);
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<SignupPromoAvailability>(queryKey, { userId: userId!, offer: null });
      if (!sessionIsCurrent()) return;
      void useSessionStore.getState().refreshSession().catch(() => undefined);
    },
    onError: (error) => {
      if (!sessionIsCurrent()) return;
      const changed = error instanceof ApiError && error.status === 409;
      if (changed) void queryClient.invalidateQueries({ queryKey });
      Alert.alert('Could not claim signup credit', changed ? error.message : 'Try again in a moment.');
    },
  });
  useEffect(() => {
    if (claimedCents === null) return;
    const timer = setTimeout(() => setClaimedCents(null), SUCCESS_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [claimedCents]);

  const card = [styles.banner, { backgroundColor: `${theme.green}17`, borderColor: `${theme.green}3D` }];
  const iconTile = [styles.iconTile, { backgroundColor: `${theme.green}26` }];
  if (claimedCents !== null) {
    return (
      <View accessibilityRole="summary" accessibilityLiveRegion="polite" style={card}>
        <View style={iconTile}><SymbolView name="checkmark.circle.fill" size={18} tintColor={theme.green} weight="semibold" /></View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: theme.text }]}>{`${currency.format(claimedCents / 100)} added to your balance.`}</Text>
          <Text style={[styles.body, { color: theme.secondary }]}>Enjoy exploring Pulpo.</Text>
        </View>
      </View>
    );
  }
  if (!supported || snoozed || !offer || !userId) return null;

  const snooze = () => {
    if (namespace) snoozedNamespaces.add(namespace);
    setSnoozed(true);
  };
  const buttonText = theme.isDark ? '#000000' : '#FFFFFF';
  return (
    <View accessibilityLabel="Signup credit" style={card}>
      <View style={iconTile}><SymbolView name="gift.fill" size={17} tintColor={theme.green} weight="semibold" /></View>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: theme.text }]}>{`${currency.format(offer.amountCents / 100)} welcome credit`}</Text>
        <Text style={[styles.body, { color: theme.secondary }]}>{offer.message || 'A little something to get you started.'}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Claim ${currency.format(offer.amountCents / 100)}`}
        accessibilityState={{ disabled: claim.isPending, busy: claim.isPending }}
        disabled={claim.isPending}
        onPress={() => { if (sessionIsCurrent()) claim.mutate(offer.amountCents); }}
        style={({ pressed }) => [styles.button, { backgroundColor: theme.green, opacity: claim.isPending ? 0.7 : pressed ? 0.8 : 1 }]}
      >
        {claim.isPending
          ? <ActivityIndicator size="small" color={buttonText} />
          : <Text style={[styles.buttonText, { color: buttonText }]}>Claim</Text>}
      </Pressable>
      <Pressable
        accessibilityLabel="Remind me later"
        accessibilityRole="button"
        disabled={claim.isPending}
        hitSlop={8}
        onPress={snooze}
        style={styles.dismiss}
      >
        <SymbolView name="xmark" size={13} tintColor={theme.secondary} weight="semibold" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 8, paddingLeft: 8, paddingRight: 4, marginBottom: 8 },
  iconTile: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 1 },
  title: { fontSize: 14, fontWeight: '600' },
  body: { fontSize: 13, lineHeight: 17 },
  button: { minHeight: 34, minWidth: 64, justifyContent: 'center', alignItems: 'center', borderRadius: 17, paddingHorizontal: 14 },
  buttonText: { fontSize: 14, fontWeight: '600' },
  dismiss: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
});
