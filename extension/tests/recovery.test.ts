import { describe, expect, it } from 'vitest';
import { interruptRunForClosedTab, runAuthorizesOperation } from '../src/shared/run-guards';
import type { Run } from '../src/shared/contracts';

const run = (overrides: Partial<Run> = {}): Run => ({
  id: 'run-1', revision: 1, tabId: 7, account: { id: '42', handle: 'alice' }, itemIds: ['delete_post:1'],
  dryRun: false, state: 'active', nextEligibleAt: 0, activeAttemptId: 'attempt-1', transport: 'direct', ...overrides
});

describe('run recovery guards', () => {
  it('refuses stale attempt tokens, account changes, and another tab before dispatch', () => {
    const operation = { attemptId: 'attempt-1', accountId: '42', accountHandle: 'alice' };
    expect(runAuthorizesOperation(run(), 7, operation)).toBe(true);
    expect(runAuthorizesOperation(run(), 7, { ...operation, attemptId: 'old-attempt' })).toBe(false);
    expect(runAuthorizesOperation(run(), 7, { ...operation, accountHandle: 'other-account' })).toBe(false);
    expect(runAuthorizesOperation(run(), 8, operation)).toBe(false);
    expect(runAuthorizesOperation(run({ state: 'cancelled' }), 7, operation)).toBe(false);
  });

  it('interrupts only the active run owned by a closed X tab', () => {
    expect(interruptRunForClosedTab(run(), 7)?.state).toBe('interrupted');
    expect(interruptRunForClosedTab(run(), 8)).toBeUndefined();
    expect(interruptRunForClosedTab(run({ state: 'paused' }), 7)).toBeUndefined();
  });
});
