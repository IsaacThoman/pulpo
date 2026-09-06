import type { QueueAction } from './QueuedMessagesView';
export type QueueRow = { kind?: 'shelf'; canRetry?: boolean; id: string; content: string; detail: string; status: string; isEditing: boolean; canEdit: boolean; canDelete: boolean; canReorder: boolean };
export function queueRowActions(rows: QueueRow[], index: number): Array<{label: string; icon: string; disabled: boolean; event: QueueAction}> {
  const row = rows[index];
  if (!row) return [];
  return [
    { label: row.kind === 'shelf' ? 'Restore draft' : row.isEditing ? 'Cancel edit' : 'Edit message', icon: row.kind === 'shelf' ? 'arrow.uturn.backward' : 'pencil', disabled: !row.canEdit, event: { id: row.id, action: 'edit' } },
    ...(index > 0 ? [{ label: 'Move up', icon: 'arrow.up', disabled: !row.canReorder || !rows[index - 1].canReorder, event: { id: row.id, action: 'reorder' as const, targetMessageId: rows[index - 1].id, edge: 'before' as const } }] : []),
    ...(index < rows.length - 1 ? [{ label: 'Move down', icon: 'arrow.down', disabled: !row.canReorder || !rows[index + 1].canReorder, event: { id: row.id, action: 'reorder' as const, targetMessageId: rows[index + 1].id, edge: 'after' as const } }] : []),
    ...(row.canRetry ? [{ label: 'Retry', icon: 'arrow.clockwise', disabled: false, event: { id: row.id, action: 'retry' as const } }] : []),
    { label: row.kind === 'shelf' ? 'Delete shelved draft' : 'Delete message', icon: 'trash', disabled: !row.canDelete, event: { id: row.id, action: 'delete' } },
  ];
}
