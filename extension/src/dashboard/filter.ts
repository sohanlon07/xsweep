import type { ItemKind, QueueItem } from '../shared/contracts';
export type SortKey = 'kind' | 'action' | 'text' | 'date' | 'state';

export function itemKind(item: QueueItem): ItemKind {
  // Migrates queues persisted before explicit categories were introduced.
  return item.kind ?? (item.action === 'unlike' ? 'like' : item.action === 'undo_repost' ? 'repost' : 'tweet');
}

export function matchesDateRange(item: QueueItem, start: string, end: string, includeUnknown: boolean): boolean {
  if (!start && !end) return true;
  if (!item.occurredAt) return includeUnknown;
  const timestamp = Date.parse(item.occurredAt);
  if (!Number.isFinite(timestamp)) return includeUnknown;
  if (start && timestamp < Date.parse(`${start}T00:00:00`)) return false;
  if (end && timestamp > Date.parse(`${end}T23:59:59.999`)) return false;
  return true;
}

export function sortItems(items: QueueItem[], key: SortKey, direction: 'asc' | 'desc'): QueueItem[] {
  const value = (item: QueueItem): string => {
    if (key === 'kind') return itemKind(item);
    if (key === 'date') return item.occurredAt ?? '';
    return String(item[key]).toLocaleLowerCase();
  };
  const factor = direction === 'asc' ? 1 : -1;
  return items.map((item, index) => ({ item, index })).sort((a, b) => {
    const compared = value(a.item).localeCompare(value(b.item), undefined, { numeric: true });
    return compared ? compared * factor : a.index - b.index;
  }).map(({ item }) => item);
}
