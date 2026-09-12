import { describe, expect, it } from 'vitest';
import { discoveryCompletionMessage } from '../src/dashboard/discover';

describe('discovery completion status', () => {
  it('explains that repeated cursors are usually an end-of-history condition', () => {
    const message = discoveryCompletionMessage({}, ['posts: repeated pagination cursor'], true, false);
    expect(message).toContain('Results are likely complete');
    expect(message).toContain('normally indicates the end of the available history');
    expect(message).toContain('posts: repeated pagination cursor');
  });

  it('keeps a safety page limit explicitly incomplete', () => {
    const message = discoveryCompletionMessage({}, ['posts: safety page limit reached'], false, true);
    expect(message).toContain('results may be incomplete');
    expect(message).toContain('safety limit');
  });

  it('preserves cancellation as partial', () => {
    expect(discoveryCompletionMessage({}, [], false, false, true)).toBe('Cancelled — partial results retained.');
  });
});
