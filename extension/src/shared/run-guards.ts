import type { Run } from './contracts';

type RoutedOperation = { attemptId?: unknown; accountId?: unknown; accountHandle?: unknown };

/** Reject stale, cross-tab, or cross-account work before it reaches X. */
export function runAuthorizesOperation(run: Run | undefined, tabId: number, operation: RoutedOperation): boolean {
  return !!run
    && run.state === 'active'
    && run.tabId === tabId
    && run.activeAttemptId === operation.attemptId
    && run.account.id === operation.accountId
    && run.account.handle.toLowerCase() === String(operation.accountHandle ?? '').toLowerCase();
}

/** A removed X tab can never continue an active cleanup run. */
export function interruptRunForClosedTab(run: Run | undefined, tabId: number): Run | undefined {
  return run?.state === 'active' && run.tabId === tabId ? { ...run, state: 'interrupted' } : undefined;
}
