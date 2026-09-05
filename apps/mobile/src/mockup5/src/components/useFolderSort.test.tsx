// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: { instanceUrl: 'https://one.example', user: { id: 'user-1' } },
  getValue: vi.fn(), setValue: vi.fn(async () => undefined), alert: vi.fn(),
}));
vi.mock('../../../store/session', () => ({ useSessionStore: (select: (state: typeof mocks.session) => unknown) => select(mocks.session) }));
vi.mock('../../../data/database', () => ({ cacheNamespace: (url: string, id: string) => `${url}|${id}`, getValue: mocks.getValue, setValue: mocks.setValue }));
vi.mock('react-native', () => ({ Alert: { alert: mocks.alert } }));
import { useFolderSort } from './useFolderSort';

let root: Root;
let host: HTMLDivElement;
let result: ReturnType<typeof useFolderSort>;
function Harness() { result = useFolderSort(); return null; }
beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { instanceUrl: 'https://one.example', user: { id: 'user-1' } };
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); });
it('loads saved order and persists changes in the current account namespace', async () => {
  mocks.getValue.mockResolvedValue('descending');
  await act(async () => root.render(<Harness />));
  expect(result[0]).toBe('descending');
  act(() => result[1]('ascending'));
  expect(mocks.setValue).toHaveBeenCalledWith('https://one.example|user-1', 'folderSort', 'ascending');
  expect(result[0]).toBe('ascending');
  mocks.getValue.mockResolvedValue(null);
  mocks.session = { instanceUrl: 'https://two.example', user: { id: 'user-2' } };
  await act(async () => root.render(<Harness />));
  expect(result[0]).toBe('default');
  expect(mocks.getValue).toHaveBeenLastCalledWith('https://two.example|user-2', 'folderSort');
});
it('does not let a slow saved-order read override a new selection', async () => {
  let resolve!: (value: string) => void;
  mocks.getValue.mockReturnValue(new Promise<string>((done) => { resolve = done; }));
  act(() => root.render(<Harness />));
  act(() => result[1]('ascending'));
  await act(async () => resolve('descending'));
  expect(result[0]).toBe('ascending');
});
