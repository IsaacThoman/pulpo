import { describe, expect, it } from 'vitest';
import { androidDialogBodyHeight } from './androidLayout';

describe('Android compact layouts', () => {
  it('leaves room for dialog controls above a keyboard and in landscape', () => {
    expect(androidDialogBodyHeight(340, 600, 1)).toBe(164);
    expect(androidDialogBodyHeight(340, 600, 2)).toBe(116);
    expect(androidDialogBodyHeight(900, 200, 1)).toBe(200);
    expect(androidDialogBodyHeight(1400, 900, 1)).toBe(440);
  });
});
