import { expect, it } from 'vitest';
import { matchesDiscoveryPage } from '../src/dashboard/discover';

it('does not accept the previous completed page when moving between categories', () => {
  expect(matchesDiscoveryPage('https://x.com/alice/with_replies', '/alice/likes')).toBe(false);
  expect(matchesDiscoveryPage('https://x.com/alice/likes', '/alice/likes')).toBe(true);
  expect(matchesDiscoveryPage('https://x.com/i/history/likes', '/alice/likes')).toBe(true);
  expect(matchesDiscoveryPage('https://x.com/i/history/likes', '/alice/with_replies')).toBe(false);
  expect(matchesDiscoveryPage('https://twitter.com/Alice/likes/?s=20', '/alice/likes')).toBe(true);
  expect(matchesDiscoveryPage('https://x.com/i/flow/login', '/alice/likes')).toBe(false);
  expect(matchesDiscoveryPage('https://example.org/alice/likes', '/alice/likes')).toBe(false);
});
