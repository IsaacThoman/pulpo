import { describe, expect, it } from 'vitest';
import { normalizeInstanceUrl } from './domain';
import { createSeedState, SEED_VERSION } from './seed';

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

describe('prototype seed', () => {
  it('ships a connected member state with broad sample data', () => {
    const state = createSeedState();
    expect(state.seedVersion).toBe(SEED_VERSION);
    expect(state.instance.url).toBe('https://pulpo.baby');
    expect(state.session.status).toBe('signed-in');
    expect(state.chats.some((chat) => chat.deletedAt !== null)).toBe(true);
    expect(state.models.some((model) => model.agentEnabled)).toBe(true);
    expect(state.usage.length).toBeGreaterThan(30);
  });
});
