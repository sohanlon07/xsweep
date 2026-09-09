import { describe, expect, it } from 'vitest';
import { itemKind, matchesDateRange, sortItems } from '../src/dashboard/filter';
import type { QueueItem } from '../src/shared/contracts';

const item = (occurredAt?: string): QueueItem => ({ id: 'delete_post:1', targetId: '1', action: 'delete_post', kind: 'tweet', text: '', source: 'archive', selected: true, state: 'pending', occurredAt });

describe('review filters', () => {
  it('applies inclusive local calendar date boundaries', () => {
    expect(matchesDateRange(item('2025-02-10T23:59:59.000Z'), '2025-02-10', '2025-02-10', false)).toBe(true);
    expect(matchesDateRange(item('2025-02-11T00:00:00.000Z'), '', '2025-02-10', false)).toBe(false);
  });
  it('shows unknown dates normally but excludes them from dated batches by default', () => {
    expect(matchesDateRange(item(), '', '', false)).toBe(true);
    expect(matchesDateRange(item(), '2025-01-01', '', false)).toBe(false);
    expect(matchesDateRange(item(), '2025-01-01', '', true)).toBe(true);
  });
  it('migrates an older uncategorised queue item', () => {
    const old = { ...item(), kind: undefined } as unknown as QueueItem;
    expect(itemKind(old)).toBe('tweet');
  });
  it('sorts every preview column without mutating queue order', () => {
    const original = [
      { ...item('2025-01-02T00:00:00Z'), id: 'delete_post:2', targetId: '2', text: 'Zulu', kind: 'reply' as const },
      { ...item('2025-01-01T00:00:00Z'), text: 'Alpha', kind: 'tweet' as const }
    ];
    expect(sortItems(original, 'text', 'asc').map(value => value.text)).toEqual(['Alpha', 'Zulu']);
    expect(sortItems(original, 'date', 'desc').map(value => value.targetId)).toEqual(['2', '1']);
    expect(sortItems(original, 'kind', 'asc').map(value => value.kind)).toEqual(['reply', 'tweet']);
    expect(original.map(value => value.targetId)).toEqual(['2', '1']);
  });
});
