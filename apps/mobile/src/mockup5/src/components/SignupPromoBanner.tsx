import { SIGNUP_PROMO_CLAIM_MS, type SignupPromoAvailability, type SignupPromoReceipt } from '@pulpo/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError, apiRequest } from '../../../api/client';
import { cacheNamespace } from '../../../data/schema';
import { useSessionStore } from '../../../store/session';
import { useAppTheme } from '../theme';

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

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
  const availability = useQuery({
    queryKey,
    queryFn: ({ signal }) => apiRequest<SignupPromoAvailability>('/api/billing/signup-promo', { signal }),
    enabled: supported && Boolean(token && user && user.role !== 'pending' && expiresAt > Date.now()),
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
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData<SignupPromoAvailability>(queryKey, { userId: userId!, offer: null });
      if (!sessionIsCurrent()) return;
      void useSessionStore.getState().refreshSession().catch(() => undefined);
      Alert.alert('Signup credit claimed', `${currency.format(receipt.amountCents / 100)} added to your balance.`);
    },
    onError: (error) => {
      if (!sessionIsCurrent()) return;
      const changed = error instanceof ApiError && error.status === 409;
      if (changed) void queryClient.invalidateQueries({ queryKey });
      Alert.alert('Could not claim signup credit', changed ? error.message : 'Try again in a moment.');
    },
  });
  if (!supported || !offer || !userId) return null;

  return (
    <View style={[styles.banner, { backgroundColor: theme.fillStrong }]}>
      <Text style={[styles.message, { color: theme.text }]}>{offer.message || 'Welcome to Pulpo! Claim your signup credit.'}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: claim.isPending }}
        disabled={claim.isPending}
        onPress={() => { if (sessionIsCurrent()) claim.mutate(offer.amountCents); }}
        style={[styles.button, { backgroundColor: claim.isPending ? theme.disabledBackground : theme.accent }]}
      >
        <Text style={[styles.buttonText, { color: claim.isPending ? theme.disabledText : theme.accentText }]}>
          {claim.isPending ? 'Claiming…' : `Claim ${currency.format(offer.amountCents / 100)}`}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, borderRadius: 14, padding: 8, paddingLeft: 12, marginBottom: 8 },
  message: { flexGrow: 1, flexBasis: 160, fontSize: 14 },
  button: { minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 10, paddingHorizontal: 10 },
  buttonText: { fontSize: 14, fontWeight: '600' },
});
