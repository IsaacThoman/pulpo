import { describe, expect, it } from 'vitest';
import { createInitialState } from './initialState';

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
