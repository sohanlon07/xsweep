import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { Store } from '../src/storage/db';
import type { Run } from '../src/shared/contracts';

const run = (id: string, state: Run['state']): Run => ({
  id, revision: 1, tabId: 1, account: { id: 'alice', handle: 'alice' },
  itemIds: [], dryRun: false, state, nextEligibleAt: 0
});

describe('run ownership', () => {
  it('retires paused work but does not replace a genuinely active run', async () => {
    const store = new Store();
    await store.put('runs', run('old', 'paused'));
    expect(await store.claim(run('new', 'active'))).toBe(true);
    expect((await store.get<Run>('runs', 'old'))?.state).toBe('cancelled');
    expect((await store.get<Run>('runs', 'new'))?.state).toBe('active');
    expect(await store.claim(run('third', 'active'))).toBe(false);
    expect(await store.get<Run>('runs', 'third')).toBeUndefined();
  });

  it('clears only local queue, run, and attempt history for a fresh start', async () => {
    const store = new Store();
    await store.put('items', { id: 'delete_post:1', targetId: '1', action: 'delete_post', kind: 'tweet', text: '', source: 'archive', selected: false, state: 'pending' });
    await store.put('runs', run('history', 'complete'));
    await store.put('attempts', { id: 'attempt', runId: 'history', itemId: 'delete_post:1', state: 'verified', createdAt: 1 });
    await store.clearHistory();
    await expect(store.all('items')).resolves.toEqual([]);
    await expect(store.all('runs')).resolves.toEqual([]);
    await expect(store.all('attempts')).resolves.toEqual([]);
  });
});
