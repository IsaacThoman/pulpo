import { SIGNUP_PROMO_CLAIM_MS, type SignupPromoAvailability, type SignupPromoReceipt } from '@pulpo/contracts';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';
import { ApiError, apiRequest } from '../../api/client';
import { cacheNamespace } from '../../data/schema';
import { useSessionStore } from '../../store/session';

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

export function useSignupPromo(active: boolean, poll = false) {
  const user = useSessionStore((state) => state.user);
  const token = useSessionStore((state) => state.token);
  const instanceUrl = useSessionStore((state) => state.instanceUrl);
  const supported = useSessionStore((state) => state.config?.capabilities.signupPromo === true);
  const userId = user?.id;
  const expiresAt = user ? Date.parse(user.createdAt) + SIGNUP_PROMO_CLAIM_MS : 0;
  const enabled = active && supported && Boolean(token && user && user.role !== 'pending' && expiresAt > Date.now());
  const namespace = userId ? cacheNamespace(instanceUrl, userId) : null;
  const queryKey = ['signup-promo', namespace];
  const queryClient = useQueryClient();
  const availability = useQuery({
    queryKey,
    queryFn: ({ signal }) => apiRequest<SignupPromoAvailability>('/api/billing/signup-promo', { signal }),
    enabled,
    refetchInterval: () => poll && Date.now() < expiresAt ? 60_000 : false,
    retry: false,
  });
  const offer = availability.data?.userId === userId ? availability.data?.offer : null;
  const sessionIsCurrent = () => {
    const session = useSessionStore.getState();
    return session.instanceUrl === instanceUrl && session.token === token && session.user?.id === userId;
  };
  const mutationKey = ['claim-signup-promo', namespace];
  const claim = useMutation({
    mutationKey,
    mutationFn: (amountCents: number) => apiRequest<SignupPromoReceipt>('/api/billing/signup-promo/claim', {
      method: 'POST', body: { userId, amountCents },
    }),
    onSuccess: async () => {
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
  const pending = useIsMutating({ mutationKey }) > 0;
  return {
    offer: enabled ? offer : null,
    claim: (amountCents: number) => { if (enabled && sessionIsCurrent()) claim.mutate(amountCents); },
    receipt: active && sessionIsCurrent() ? claim.data : undefined,
    pending,
    checking: enabled && availability.isPending,
  };
}

export function signupPromoClaimLabel(amountCents: number, pending: boolean) {
  return pending ? 'Claiming…' : `Claim ${currency.format(amountCents / 100)}`;
}

export function signupPromoSuccessLabel(amountCents: number) {
  return `${currency.format(amountCents / 100)} added to your balance.`;
}
