import { describe, expect, it } from 'vitest';
import { abortableDelay, adaptiveDelay } from '../src/dashboard/execution';
describe('direct request pacing', () => {
  it('starts between three and five seconds and honors exhausted reset windows', () => {
    expect(adaptiveDelay(undefined, 1000, 0)).toBe(3000);
    expect(adaptiveDelay(undefined, 1000, 1)).toBe(5000);
    expect(adaptiveDelay({ limit: 100, remaining: 1, resetAt: 11000, nextEligibleAt: 0 }, 1000, 0)).toBe(11000);
  });
});
describe('cancellable direct pacing', () => {
  it('does not complete a delay after cancellation', async () => {
    const controller = new AbortController();
    const wait = abortableDelay(1_000, controller.signal);
    controller.abort();
    await expect(wait).resolves.toBe(false);
  });
});
