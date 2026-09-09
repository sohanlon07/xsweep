import { describe, expect, it } from 'vitest';
import { isTargetPage, targetUrl } from '../src/dashboard/execution';
import type { QueueItem } from '../src/shared/contracts';

const item: QueueItem = { id: 'delete_post:123', targetId: '123', action: 'delete_post', kind: 'tweet', text: '', source: 'archive', selected: true, state: 'pending' };
describe('execution target navigation', () => {
  it('uses a validated canonical permalink when available', () => {
    expect(targetUrl({ ...item, permalink: 'https://x.com/alice/status/123' })).toBe('https://x.com/alice/status/123');
    expect(targetUrl({ ...item, permalink: 'https://example.com/status/123' })).toBe('https://x.com/i/web/status/123');
  });
  it('only accepts the exact target status page on X', () => {
    expect(isTargetPage('https://x.com/alice/status/123', '123')).toBe(true);
    expect(isTargetPage('https://x.com/alice/status/1234', '123')).toBe(false);
    expect(isTargetPage('https://example.com/alice/status/123', '123')).toBe(false);
  });
});
