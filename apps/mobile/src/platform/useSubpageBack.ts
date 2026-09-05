import { useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';

/** Keep Android system Back aligned with a screen's local Back action. */
export function useSubpageBack(active: boolean, onBack: () => void) {
  useEffect(() => {
    if (Platform.OS !== 'android' || !active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [active, onBack]);
}
