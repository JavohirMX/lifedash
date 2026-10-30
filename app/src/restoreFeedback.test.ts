import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ transaction: vi.fn(), restoreAutomation: vi.fn(), bulkPut: vi.fn() }));
vi.mock('./db', () => ({ db: {
  transaction: (...args: unknown[]) => state.transaction(...args),
  table: () => ({ bulkPut: state.bulkPut }),
  focusSessions: { toArray: async () => [] },
} }));
vi.mock('./automation', async (original) => ({ ...(await original<typeof import('./automation')>()), restoreAutomation: state.restoreAutomation }));
import { importBackup } from './repo';
const backup = JSON.stringify({ version: 2, tasks: [{ id: 'fictional' }], automation: { rules: {} } });
describe('backup restore failure boundaries', () => {
  beforeEach(() => { vi.clearAllMocks(); state.transaction.mockImplementation(async (...args: unknown[]) => (args.at(-1) as () => Promise<void>)()); state.restoreAutomation.mockImplementation(() => {}); });
  it('returns record counts after records and automation succeed', async () => {
    await expect(importBackup(backup)).resolves.toEqual({ restored: { tasks: 1 } });
    expect(state.bulkPut).toHaveBeenCalledWith([{ id: 'fictional' }]);
    expect(state.restoreAutomation).toHaveBeenCalledWith({ rules: {} });
  });
  it('names the saved record state if automation fails after records', async () => {
    state.restoreAutomation.mockImplementation(() => { throw Error('storage blocked'); });
    await expect(importBackup(backup)).rejects.toThrow('Backup records were restored, but automation settings could not be fully restored. Check your records and Automation before restoring again.');
    expect(state.bulkPut).toHaveBeenCalledOnce();
  });
  it('preserves database errors and never touches automation after transaction failure', async () => {
    state.transaction.mockRejectedValueOnce(Error('database write failed'));
    await expect(importBackup(backup)).rejects.toThrow('database write failed');
    expect(state.restoreAutomation).not.toHaveBeenCalled();
  });
  it('keeps validation failures before any write', async () => {
    await expect(importBackup(JSON.stringify({ version: 2, tasks: [{}] }))).rejects.toThrow('Nothing was restored.');
    expect(state.transaction).not.toHaveBeenCalled();
    expect(state.restoreAutomation).not.toHaveBeenCalled();
  });
});
