import morphs from '../../assets/loading/material-morphs.json';

export const MORPH_INTERVAL_MS = 650;

export function loadingFrame(elapsed: number) {
  'worklet';
  const cycle = Math.floor(elapsed / MORPH_INTERVAL_MS);
  const seconds = (elapsed % MORPH_INTERVAL_MS) / 1000;
  // Material's underdamped spring: dampingRatio 0.6, stiffness 200.
  const frequency = Math.sqrt(200);
  const damped = frequency * 0.8;
  const progress = seconds >= 0.6 ? 1 : 1 - Math.exp(-0.6 * frequency * seconds)
    * (Math.cos(damped * seconds) + 0.75 * Math.sin(damped * seconds));
  return {
    index: cycle % morphs.length,
    progress,
    rotation: 90 + cycle * 90 + progress * 90 + elapsed / 4666 * 360,
  };
}

export function loadingPath(index: number, progress: number) {
  'worklet';
  const [from, to] = morphs[index]!;
  const values = from!.map((value, i) => value + (to![i]! - value) * progress);
  let path = `M${values[0]},${values[1]}`;
  for (let i = 2; i < values.length; i += 6) path += `C${values.slice(i, i + 6).join(',')}`;
  return path + 'Z';
}
