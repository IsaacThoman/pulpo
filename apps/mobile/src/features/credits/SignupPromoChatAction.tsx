import { Pressable, Text, type Insets, type StyleProp, type TextStyle } from 'react-native'
import { formatUsdMicros } from './format'
import { useSignupPromoClaim, useSignupPromoOffer } from './useCredits'

/**
 * Beside an out-of-usage error in chat, like the web: Claim while the signup promo can be claimed,
 * then a note to try again. Render it only where `useCreditsAvailable` allows.
 */
export function SignupPromoChatAction({ textStyle, hitSlop }: { textStyle: StyleProp<TextStyle>; hitSlop?: Insets }) {
  const offer = useSignupPromoOffer(true)
  const { claim, claiming, claimedMicros, error } = useSignupPromoClaim()
  if (claimedMicros !== null) return <Text accessibilityRole="alert" style={textStyle}>{`${formatUsdMicros(claimedMicros)} added`}</Text>
  if (error) return <Pressable accessibilityRole="button" accessibilityHint={error} hitSlop={hitSlop} onPress={() => void claim()}><Text style={textStyle}>Claim failed. Retry</Text></Pressable>
  if (!offer.data?.available) return null
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: claiming, busy: claiming }} disabled={claiming} hitSlop={hitSlop} onPress={() => void claim()}>
    <Text style={textStyle}>{claiming ? 'Claiming…' : `Claim ${formatUsdMicros(offer.data.amountMicros)}`}</Text>
  </Pressable>
}
