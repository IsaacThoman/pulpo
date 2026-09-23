import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const directory = join(__dirname, '../../assets/material');

describe('Android vector icons', () => {
  // Expo UI's Compose vector loader reads only pathData and fillColor, and
  // resolves @android:color/transparent to black. Stroked outlines therefore
  // render as solid filled shapes once tinted.
  it.each(readdirSync(directory).filter((file) => file.endsWith('.xml')))('%s draws with filled paths only', (file) => {
    const xml = readFileSync(join(directory, file), 'utf8');
    expect(xml).not.toMatch(/android:stroke/);
    expect(xml).not.toMatch(/fillColor="@android:color\/transparent"/);
  });
});
