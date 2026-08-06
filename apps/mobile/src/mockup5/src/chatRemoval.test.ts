import { describe, expect, it } from 'vitest';
import type { TrashRetention } from './domain';
import { chatRemovalBehavior } from './chatRemoval';

describe('chat removal behavior', () => {
  it('keeps the Delete label and confirmation when trash has no retention', () => {
    expect(chatRemovalBehavior('instant')).toEqual({
      label: 'Delete',
      requiresConfirmation: true,
    });
  });

  it.each<TrashRetention>(['24h', '7d', '30d', '90d', 'indefinite'])(
    'uses Trash without confirmation for %s retention',
    (retention) => {
      expect(chatRemovalBehavior(retention)).toEqual({
        label: 'Trash',
        requiresConfirmation: false,
      });
    },
  );
});
