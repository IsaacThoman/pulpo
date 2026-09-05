import { describe, expect, it } from 'vitest';
import { androidDialogBodyHeight, quickModelChoices } from './androidLayout';

describe('Android compact layouts', () => {
  it('keeps the selected model and ordered favorites reachable without a full-screen menu', () => {
    const models = Array.from({ length: 50 }, (_, id) => ({ id: String(id) }));
    expect(quickModelChoices(models, '49', ['missing', '8', '8', '2', '3', '4']).map((model) => model.id)).toEqual(['49', '8', '2', '3', '4']);
    expect(quickModelChoices([], 'missing', [])).toEqual([]);
  });
  it('leaves room for dialog controls above a keyboard and in landscape', () => {
    expect(androidDialogBodyHeight(340, 600, 1)).toBe(164);
    expect(androidDialogBodyHeight(340, 600, 2)).toBe(116);
    expect(androidDialogBodyHeight(900, 200, 1)).toBe(200);
    expect(androidDialogBodyHeight(1400, 900, 1)).toBe(440);
  });
});
