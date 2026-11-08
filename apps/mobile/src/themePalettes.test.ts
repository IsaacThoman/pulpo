import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { highContrastThemePalettes, themePalettes } from './themePalettes';

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

describe('mobile theme contrast with Increase Contrast', () => {
  for (const [name, palette] of Object.entries(highContrastThemePalettes)) {
    it(`${name} keeps text, secondary text and semantic colors at 7:1 or better`, () => {
      const foregrounds = [palette.text, palette.secondary, palette.blue, palette.green, palette.orange, palette.red];
      for (const foreground of foregrounds) {
        for (const background of [palette.background, palette.elevated, palette.elevated2]) {
          expect(contrastRatio(foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(7);
        }
      }
    });

    it(`${name} raises tertiary glyphs above the 3:1 needed for icons`, () => {
      for (const background of [palette.background, palette.elevated, palette.elevated2]) {
        expect(contrastRatio(palette.tertiary, background), `${palette.tertiary} on ${background}`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('tertiary color', () => {
  it('is too faint for text (under 4.5:1), so text never uses it', () => {
    expect(contrastRatio(themePalettes.light.tertiary, themePalettes.light.elevated)).toBeLessThan(4.5);
    // Chevrons and other glyphs may; text uses theme.secondary.
    const offenders = sourceFiles(__dirname).filter((path) => /<Text\b[^>]*color: *(?:theme|colors|palette)\.tertiary/.test(readFileSync(path, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
