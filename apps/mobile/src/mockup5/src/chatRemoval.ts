import type { TrashRetention } from './domain';

export function chatRemovalBehavior(retention: TrashRetention): {
  label: 'Delete' | 'Trash';
  requiresConfirmation: boolean;
} {
  const trashEnabled = retention !== 'instant';
  return {
    label: trashEnabled ? 'Trash' : 'Delete',
    requiresConfirmation: !trashEnabled,
  };
}
