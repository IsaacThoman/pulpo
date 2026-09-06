// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
const animation = vi.hoisted(() => ({ setActive: vi.fn(), elapsed: { value: 0 } }));
vi.mock('react-native', () => ({}));
vi.mock('react-native-reanimated', async () => {
  const { createElement } = await import('react');
  return {
    default: {
      View: ({ children }: { children: React.ReactNode }) => createElement('div', null, children),
      createAnimatedComponent: (component: unknown) => component,
    },
    useSharedValue: () => animation.elapsed,
    useFrameCallback: () => animation,
    useAnimatedProps: (callback: () => unknown) => callback(),
    useAnimatedStyle: (callback: () => unknown) => callback(),
  };
});
vi.mock('react-native-svg', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ children }: { children: React.ReactNode }) => createElement('svg', null, children),
    G: ({ children }: { children: React.ReactNode }) => createElement('g', null, children),
    Path: ({ d, fill }: { d: string; fill: string }) => createElement('path', { d, fill }),
  };
});
import { ExpressiveLoadingIndicator } from './ExpressiveLoadingIndicator';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

it('stops for Reduce Motion, resumes when disabled, and cancels on unmount', async () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<ExpressiveLoadingIndicator color="#6d28d9" reduceMotion={false} />));
    expect(animation.setActive).toHaveBeenLastCalledWith(true);
    animation.elapsed.value = 1000;
    await act(async () => root.render(<ExpressiveLoadingIndicator color="#d8b4fe" reduceMotion />));
    expect(animation.setActive).toHaveBeenLastCalledWith(false);
    expect(animation.elapsed.value).toBe(0);
    expect(container.querySelector('path')?.getAttribute('fill')).toBe('#d8b4fe');
    expect(container.querySelector('path')?.getAttribute('d')).toMatch(/^M.+Z$/);
    await act(async () => root.render(<ExpressiveLoadingIndicator color="#d8b4fe" reduceMotion={false} />));
    expect(animation.setActive).toHaveBeenLastCalledWith(true);
  } finally {
    await act(async () => root.unmount());
  }
  expect(animation.setActive).toHaveBeenLastCalledWith(false);
});
