import { describe, expect, it } from 'vitest';
import { discoveryCompletionMessage } from '../src/dashboard/discover';

describe('discovery completion status', () => {
  it('summarizes a safe pagination stop concisely', () => {
    const message = discoveryCompletionMessage({ start: '2026-08-28', end: '2026-09-27' }, true, false);
    expect(message).toBe('Discovery likely complete for 2026-08-28 to 2026-09-27; X history stopped advancing.');
  });

  it('keeps a safety page limit explicitly incomplete', () => {
    const message = discoveryCompletionMessage({}, false, true);
    expect(message).toContain('results may be incomplete');
    expect(message).toContain('safety limit');
  });

  it('preserves cancellation as partial', () => {
    expect(discoveryCompletionMessage({}, false, false, true)).toBe('Cancelled — partial results retained.');
  });
});
