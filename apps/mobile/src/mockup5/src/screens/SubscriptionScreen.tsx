import { useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button as SwiftUIButton,
  Form as SwiftUIForm,
  HStack as SwiftUIHStack,
  Host as SwiftUIHost,
  Label as SwiftUILabel,
  LabeledContent as SwiftUILabeledContent,
  Link as SwiftUILink,
  ProgressView as SwiftUIProgressView,
  Section as SwiftUISection,
  Spacer as SwiftUISpacer,
  Text as SwiftUIText,
  VStack as SwiftUIVStack,
} from '@expo/ui/swift-ui';
import { buttonStyle, disabled, font, foregroundStyle, tint } from '@expo/ui/swift-ui/modifiers';
import { ApiError, mobileApi } from '../../../api/client';
import {
  PAID_PLANS,
  appStorePlanOptions,
  billingPeriodLabel,
  hasSubscriptionForAnotherAccount,
  planBenefits,
  planNames,
  restorePurchases,
  storeKit,
  subscriptionStatusText,
  syncAccountEntitlements,
  syncStoreTransaction,
} from '../../../features/billing/appStore';
import { useSessionStore } from '../../../store/session';
import type { PaidBillingPlan } from '../../../types';
import { Card, ListRow, PageHeader, Screen } from '../components/PrototypeUI';
import type { RootStackParamList } from '../navigation';
import { useAppTheme } from '../theme';

const TERMS_URL = 'https://help.pulpo.baby/terms-hosted';
const PRIVACY_URL = 'https://help.pulpo.baby/privacy-hosted';

// Apple's required disclosure for auto-renewable subscriptions (App Review Guideline 3.1.2).
const RENEWAL_TERMS = 'Payment is charged to your Apple Account when you confirm the purchase. Subscriptions renew automatically at the price shown unless canceled at least 24 hours before the end of the current period, and your account is charged for the renewal within 24 hours before the period ends. Manage or cancel your subscription in your App Store account settings.';

const formatDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function SubscriptionScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Subscription'>) {
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const instanceUrl = useSessionStore((state) => state.instanceUrl);
  const userId = useSessionStore((state) => state.user?.id ?? null);
  const [busy, setBusy] = useState<PaidBillingPlan | 'restore' | 'manage' | null>(null);
  const summary = useQuery({ queryKey: ['billing', instanceUrl, userId], queryFn: mobileApi.billingSummary, enabled: Boolean(userId) });
  const productIds = summary.data?.appStore?.productIds ?? null;
  const products = useQuery({
    queryKey: ['app-store-products', productIds?.eight, productIds?.fat],
    queryFn: () => storeKit!.getProducts([productIds!.eight, productIds!.fat]),
    enabled: Boolean(storeKit && productIds),
    staleTime: 60 * 60 * 1_000,
  });
  const canMakePayments = useQuery({
    queryKey: ['app-store-can-make-payments'],
    queryFn: () => storeKit!.canMakePayments(),
    enabled: Boolean(storeKit),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['billing'] });
  const appStoreEnabled = Boolean(summary.data?.appStore);

  useEffect(() => {
    if (!appStoreEnabled || !userId) return;
    void syncAccountEntitlements(userId).then(() => queryClient.invalidateQueries({ queryKey: ['billing'] }));
  }, [appStoreEnabled, queryClient, userId]);

  const purchase = async (plan: PaidBillingPlan) => {
    const productId = productIds?.[plan];
    if (!storeKit || !productId || !userId || busy) return;
    setBusy(plan);
    try {
      // Apple would change that account's subscription instead of starting a new one.
      if (await hasSubscriptionForAnotherAccount(userId)) {
        Alert.alert('Subscription linked to another account', 'This Apple Account already pays for a Pulpo subscription that belongs to a different Pulpo account. Sign in to that account to change it.');
        return;
      }
      const result = await storeKit.purchase(productId, userId);
      if (result.status === 'pending') Alert.alert('Purchase pending', 'Your plan will update after the purchase is approved.');
      if (result.status !== 'purchased' || !result.transaction) return;
      try {
        await syncStoreTransaction(result.transaction, userId);
      } catch (error) {
        Alert.alert('Purchase received', error instanceof ApiError && error.code === 'app_store_account_mismatch'
          ? error.message
          : 'Pulpo hasn’t confirmed your purchase yet. Your plan will update automatically.');
      }
    } catch (error) {
      Alert.alert('Purchase failed', error instanceof Error ? error.message : 'The App Store could not complete the purchase.');
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const restore = async () => {
    if (!userId || busy) return;
    setBusy('restore');
    try {
      const result = await restorePurchases(userId);
      if (result === 'restored') Alert.alert('Purchases restored', 'Your App Store subscription is linked to this account.');
      else if (result === 'other_account') Alert.alert('Subscription linked to another account', 'This Apple Account’s Pulpo subscription belongs to a different Pulpo account.');
      else Alert.alert('No subscription found', 'This Apple Account has no active Pulpo subscription.');
    } catch (error) {
      Alert.alert('Restore failed', error instanceof Error ? error.message : 'Could not restore purchases.');
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const manage = async () => {
    if (!storeKit || busy) return;
    setBusy('manage');
    try {
      await storeKit.showManageSubscriptions();
    } catch (error) {
      Alert.alert('Could not open subscriptions', error instanceof Error ? error.message : 'Try again from your App Store account settings.');
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const data = summary.data;
  const options = data ? appStorePlanOptions(data) : null;
  const productFor = (plan: PaidBillingPlan) => products.data?.find((product) => product.id === productIds?.[plan]);
  const purchasesRestricted = canMakePayments.data === false;
  const footnote = [font({ textStyle: 'footnote' }), foregroundStyle('secondary')];

  if (Platform.OS === 'ios') return <SwiftUIHost modifiers={[tint(theme.blue)]} style={styles.flex}><SwiftUIForm>
    <SwiftUISection title="Your plan">
      {data ? <>
        <SwiftUILabeledContent label="Plan"><SwiftUIText>{planNames[data.plan]}</SwiftUIText></SwiftUILabeledContent>
        <SwiftUIText modifiers={footnote}>{subscriptionStatusText(data, formatDate)}</SwiftUIText>
        {data.onHold ? <SwiftUIText modifiers={[font({ textStyle: 'footnote' }), foregroundStyle(theme.red)]}>Billing access is on hold. Contact support@pulpo.baby.</SwiftUIText> : null}
        {data.subscription?.provider === 'app_store'
          ? <SwiftUIButton label="Manage Subscription" systemImage="gearshape" onPress={() => void manage()} modifiers={[disabled(busy !== null)]} />
          : null}
      </> : summary.isError
        ? <SwiftUIButton label="Couldn’t load your plan. Try again" systemImage="arrow.clockwise" onPress={() => void summary.refetch()} />
        : <SwiftUIProgressView />}
    </SwiftUISection>
    {data && !options ? <SwiftUISection>
      <SwiftUIText modifiers={footnote}>This plan isn’t billed through the App Store, so it can’t be changed in this app.</SwiftUIText>
    </SwiftUISection> : null}
    {data && options && data.appStore ? PAID_PLANS.map((plan) => {
      const product = productFor(plan);
      const option = options[plan];
      const period = billingPeriodLabel(product?.period);
      return <SwiftUISection key={plan} title={planNames[plan]}>
        <SwiftUIHStack spacing={12}>
          <SwiftUIVStack alignment="leading" spacing={2}>
            <SwiftUIText modifiers={[font({ textStyle: 'headline' })]}>{product ? `${product.displayPrice} / ${period}` : products.isPending ? 'Loading price…' : 'Price unavailable'}</SwiftUIText>
            <SwiftUIText modifiers={footnote}>{`Auto-renews every ${period}`}</SwiftUIText>
          </SwiftUIVStack>
          <SwiftUISpacer />
          {busy === plan ? <SwiftUIProgressView /> : <SwiftUIButton
            label={option.label}
            onPress={() => void purchase(plan)}
            modifiers={[buttonStyle(option.purchasable ? 'borderedProminent' : 'bordered'), disabled(!option.purchasable || !product || purchasesRestricted || busy !== null)]}
          />}
        </SwiftUIHStack>
        {planBenefits(plan, data).map((benefit) => <SwiftUILabel key={benefit} title={benefit} systemImage="checkmark" />)}
      </SwiftUISection>;
    }) : null}
    {data?.appStore ? <SwiftUISection footer={<SwiftUIText modifiers={footnote}>{purchasesRestricted ? `Purchases are restricted on this device. ${RENEWAL_TERMS}` : RENEWAL_TERMS}</SwiftUIText>}>
      <SwiftUIButton label="Restore Purchases" systemImage="arrow.clockwise" onPress={() => void restore()} modifiers={[disabled(busy !== null)]} />
      <SwiftUILink label="Terms of Service" destination={TERMS_URL} />
      <SwiftUILink label="Privacy Policy" destination={PRIVACY_URL} />
    </SwiftUISection> : null}
  </SwiftUIForm></SwiftUIHost>;

  // App Store subscriptions are only sold on iOS.
  return <Screen><PageHeader title="Subscription" onBack={() => navigation.goBack()} /><Card>
    <ListRow title="Plan" value={data ? planNames[data.plan] : '…'} />
    <ListRow title="Status" detail={data ? subscriptionStatusText(data, formatDate) : undefined} last />
  </Card></Screen>;
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
