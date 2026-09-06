import { useEffect } from 'react';
import type { ColorValue } from 'react-native';
import Reanimated, { useAnimatedProps, useAnimatedStyle, useFrameCallback, useSharedValue } from 'react-native-reanimated';
import Svg, { G, Path } from 'react-native-svg';
import { loadingFrame, loadingPath } from './expressiveLoading';

const AnimatedPath = Reanimated.createAnimatedComponent(Path);

/** Material shape morphs for platforms without Compose, or a static reduced-motion shape. */
export function ExpressiveLoadingIndicator({ color, reduceMotion }: { color: ColorValue; reduceMotion: boolean }) {
  const elapsed = useSharedValue(0);
  const frame = useFrameCallback(({ timeSincePreviousFrame }) => {
    elapsed.value += timeSincePreviousFrame ?? 0;
  }, false);
  useEffect(() => {
    elapsed.value = 0;
    frame.setActive(!reduceMotion);
    return () => frame.setActive(false);
  }, [elapsed, frame, reduceMotion]);
  const animatedProps = useAnimatedProps(() => {
    const { index, progress } = loadingFrame(elapsed.value);
    return { d: loadingPath(index, progress) };
  });
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${loadingFrame(elapsed.value).rotation}deg` }] }));
  return <Reanimated.View style={[{ width: 48, height: 48 }, style]}>
    <Svg width={48} height={48} viewBox="0 0 1 1">
      <G transform="translate(0.5 0.5) scale(0.74) translate(-0.5 -0.5)">
        <AnimatedPath d={loadingPath(0, 0)} animatedProps={animatedProps} fill={color} />
      </G>
    </Svg>
  </Reanimated.View>;
}
