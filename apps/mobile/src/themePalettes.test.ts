import { describe, expect, it } from 'vitest';
import { themePalettes } from './themePalettes';

function channelToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/.{2}/g)?.map((channel) => channelToLinear(Number.parseInt(channel, 16)));
  if (!channels || channels.length !== 3) throw new Error(`Expected a six-digit hex color, received ${hex}`);
  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('mobile theme contrast', () => {
  for (const [name, palette] of Object.entries(themePalettes)) {
    it(`${name} keeps readable text and semantic colors above 4.5:1 on every content surface`, () => {
      const foregrounds = [palette.text, palette.secondary, palette.blue, palette.green, palette.orange, palette.red];
      const backgrounds = [palette.background, palette.elevated, palette.elevated2];

      for (const foreground of foregrounds) {
        for (const background of backgrounds) {
          expect(contrastRatio(foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`${name} keeps accent button labels above 4.5:1`, () => {
      expect(contrastRatio(palette.accentText, palette.accent)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${name} keeps disabled button labels above 4.5:1`, () => {
      expect(contrastRatio(palette.disabledText, palette.disabledBackground)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
