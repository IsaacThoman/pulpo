import { describe, expect, it } from 'vitest';
import { normalizeInstanceUrl } from './domain';
import { createInitialState } from './initialState';

describe('normalizeInstanceUrl', () => {
  it('defaults a bare hostname to HTTPS and strips paths', () => {
    expect(normalizeInstanceUrl('pulpo.baby/settings?tab=one')).toBe('https://pulpo.baby');
  });

  it('keeps explicit local HTTP instances', () => {
    expect(normalizeInstanceUrl('http://localhost:8080/')).toBe('http://localhost:8080');
  });

  it('rejects credentials and non-web protocols', () => {
    expect(() => normalizeInstanceUrl('https://user:secret@pulpo.baby')).toThrow();
    expect(() => normalizeInstanceUrl('file:///tmp/pulpo')).toThrow();
  });
});

describe('initial state', () => {
  it('starts signed out without account-scoped sample data', () => {
    const state = createInitialState();
    expect(state.instance.url).toBe('https://pulpo.baby');
    expect(state.session).toEqual({ status: 'signed-out', user: null });
    expect(state.chats).toEqual([]);
    expect(state.models).toEqual([]);
    expect(state.folders).toEqual([]);
    expect(state.preferences.sendWithEnter).toBe(true);
  });
});
