import type { QueueAction } from './QueuedMessagesView';
export type QueueRow = { id: string; content: string; detail: string; status: string; isEditing: boolean; canEdit: boolean; canDelete: boolean; canReorder: boolean };
export function queueRowActions(rows: QueueRow[], index: number): Array<{label: string; icon: string; disabled: boolean; event: QueueAction}> {
  const row = rows[index];
  if (!row) return [];
  return [
    { label: row.isEditing ? 'Cancel edit' : 'Edit message', icon: 'pencil', disabled: !row.canEdit, event: { id: row.id, action: 'edit' } },
    ...(index > 0 ? [{ label: 'Move up', icon: 'arrow.up', disabled: !row.canReorder || !rows[index - 1].canReorder, event: { id: row.id, action: 'reorder' as const, targetMessageId: rows[index - 1].id, edge: 'before' as const } }] : []),
    ...(index < rows.length - 1 ? [{ label: 'Move down', icon: 'arrow.down', disabled: !row.canReorder || !rows[index + 1].canReorder, event: { id: row.id, action: 'reorder' as const, targetMessageId: rows[index + 1].id, edge: 'after' as const } }] : []),
    { label: 'Delete message', icon: 'trash', disabled: !row.canDelete, event: { id: row.id, action: 'delete' } },
  ];
}
