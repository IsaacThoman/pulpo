import { describe, expect, it } from 'vitest';
import { queueRowActions, type QueueRow } from './queueRowActions';
const row = (id: string, overrides: Partial<QueueRow> = {}): QueueRow => ({id, content: id, detail: '', status: 'queued', isEditing: false, canEdit: true, canDelete: true, canReorder: true, ...overrides});
describe('Android queue actions', () => {
  it('targets the adjacent message using the server before/after contract', () => {
    const rows = [row('first'), row('middle'), row('last')];
    expect(queueRowActions(rows, 1).find((action) => action.label === 'Move up')?.event).toEqual({id: 'middle', action: 'reorder', targetMessageId: 'first', edge: 'before'});
    expect(queueRowActions(rows, 1).find((action) => action.label === 'Move down')?.event).toEqual({id: 'middle', action: 'reorder', targetMessageId: 'last', edge: 'after'});
    expect(queueRowActions(rows, 0).some((action) => action.label === 'Move up')).toBe(false);
    expect(queueRowActions(rows, 2).some((action) => action.label === 'Move down')).toBe(false);
  });
  it('prevents reorder across a dispatching or editing message', () => {
    const rows = [row('sending', {canReorder: false}), row('queued')];
    expect(queueRowActions(rows, 1).find((action) => action.label === 'Move up')?.disabled).toBe(true);
  });
  it('honors queue locks and exposes cancel edit without changing the event protocol', () => {
    const [edit, remove] = queueRowActions([row('locked', {isEditing: true, canDelete: false, canReorder: false})], 0);
    expect(edit.label).toBe('Cancel edit');
    expect(edit.event.action).toBe('edit');
    expect(remove.disabled).toBe(true);
    expect(queueRowActions([], 0)).toEqual([]);
  });
});
