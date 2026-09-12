import type { Category } from '../content/discovery';
import type { Account, QueueItem, Run } from '../shared/contracts';
import type { DirectDiscoveryResponse, DiscoveryCategory } from '../shared/messages';
import { store } from '../storage/db';

export interface DiscoveryRange { start?: string; end?: string }
const CATEGORIES: Category[] = ['posts', 'replies', 'likes'];
const MAX_PAGES_PER_CATEGORY = 1000;
const DISCOVERY_RESPONSE_TIMEOUT_MS = 45_000;

function timestamp(value: string, end = false): number | undefined {
  const parsed = Date.parse(`${value}T${end ? '23:59:59.999' : '00:00:00'}`);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function validateDiscoveryRange(range: DiscoveryRange): void {
  if (range.start && !/^\d{4}-\d{2}-\d{2}$/.test(range.start)) throw new Error('Choose a valid discovery start date.');
  if (range.end && !/^\d{4}-\d{2}-\d{2}$/.test(range.end)) throw new Error('Choose a valid discovery end date.');
  const start = range.start ? timestamp(range.start) : undefined;
  const end = range.end ? timestamp(range.end, true) : undefined;
  if (start !== undefined && end !== undefined && start > end) throw new Error('The discovery start date must be before the end date.');
}

export function isInDiscoveryRange(item: QueueItem, range: DiscoveryRange): boolean {
  const value = item.createdAt ?? item.occurredAt;
  const created = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(created)) return false;
  const start = range.start ? timestamp(range.start) : undefined;
  const end = range.end ? timestamp(range.end, true) : undefined;
  return (start === undefined || created >= start) && (end === undefined || created <= end);
}

function reachedStart(oldest: string | undefined, range: DiscoveryRange): boolean {
  if (!range.start || !oldest) return false;
  const start = timestamp(range.start);
  const created = Date.parse(oldest);
  return start !== undefined && Number.isFinite(created) && created <= start;
}

function rangeLabel(range: DiscoveryRange): string {
  if (!range.start && !range.end) return 'all history';
  return `${range.start ?? 'the earliest available date'} to ${range.end ?? 'today'}`;
}

export function discoveryCompletionMessage(range: DiscoveryRange, reasons: string[], safePaginationStop: boolean, unsafePaginationStop: boolean, cancelled = false): string {
  if (cancelled) return 'Cancelled — partial results retained.';
  if (unsafePaginationStop) return `Direct discovery stopped at a safety limit; results may be incomplete. ${reasons.join('; ')}`;
  if (safePaginationStop) return `Direct discovery finished with a safe pagination stop. Results are likely complete for ${rangeLabel(range)}: X stopped advancing its history cursor or repeated a stable page, which normally indicates the end of the available history. Results can still be incomplete if X truncated the response or changed its schema. ${reasons.join('; ')}`;
  return `Direct discovery finished for ${rangeLabel(range)}. ${reasons.join('; ')}`;
}

function awaitResponse<T>(request: Promise<T>, signal: AbortSignal, description: string): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('Discovery cancelled.'));
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => finish(() => reject(new Error(`${description} did not respond within 45 seconds. Partial results were retained.`))), DISCOVERY_RESPONSE_TIMEOUT_MS);
    const abort = () => finish(() => reject(new Error('Discovery cancelled.')));
    const finish = (callback: () => void) => { clearTimeout(timeout); signal.removeEventListener('abort', abort); callback(); };
    signal.addEventListener('abort', abort, { once: true });
    request.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
  });
}

export async function discover(tabId: number, account: Account, categories: Category[], range: DiscoveryRange, signal: AbortSignal, progress: (items: QueueItem[], detail: string) => Promise<void>) {
  if (!/^[A-Za-z0-9_]{1,15}$/.test(account.handle) || !categories.length || categories.some(category => !CATEGORIES.includes(category))) throw new Error('Choose at least one valid history category.');
  validateDiscoveryRange(range);
  const run: Run = { id: crypto.randomUUID(), revision: 1, tabId, account, itemIds: [], dryRun: true, state: 'active', nextEligibleAt: 0, transport: 'direct' };
  if (!await store.claim(run)) throw new Error('Another discovery or cleanup run is active.');
  const cancelRemote = () => { void chrome.tabs.sendMessage(tabId, { type: 'cancel', runId: run.id }).catch(() => undefined); };
  signal.addEventListener('abort', cancelRemote, { once: true });
  const found = new Map<string, QueueItem>();
  const reasons: string[] = [];
  let completed = false;
  let safePaginationStop = false;
  let unsafePaginationStop = false;
  const delay = () => new Promise<void>(resolve => { const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }; const timer = setTimeout(done, 1500); signal.addEventListener('abort', done, { once: true }); if (signal.aborted) done(); });
  const add = (candidates: QueueItem[]) => {
    let count = 0;
    for (const item of candidates) if (isInDiscoveryRange(item, range) && !found.has(item.id)) { found.set(item.id, item); count++; }
    return count;
  };
  try {
    const requestCategories: DiscoveryCategory[] = categories.flatMap(category => category === 'likes' ? ['likes', 'reposts'] : [category]);
    for (const category of requestCategories) {
        if (signal.aborted) break;
        let nextCursor: string | undefined;
        let complete = false;
        let stopReason = 'API history exhausted';
        let unchangedPages = 0;
        const seenCursors = new Set<string>();
        const seenPageKeys = new Set<string>();
        for (let page = 0; !complete && !signal.aborted && page < MAX_PAGES_PER_CATEGORY; page++) {
          const response = await awaitResponse(chrome.tabs.sendMessage(tabId, { type: 'direct-discover', runId: run.id, category, handle: account.handle, cursor: nextCursor }) as Promise<DirectDiscoveryResponse>, signal, `Direct ${category} discovery`) as DirectDiscoveryResponse;
          if (!response.ok) throw new Error(response.error);
          const added = add(response.items);
          const oldest = response.items.map(item => item.createdAt ?? item.occurredAt).filter((value): value is string => !!value).sort()[0];
          const previousCursor = nextCursor;
          const followingCursor = response.cursor;
          const repeatedCursor = !!followingCursor && (followingCursor === previousCursor || seenCursors.has(followingCursor));
          const repeatedPage = !!response.pageKey && seenPageKeys.has(response.pageKey);
          if (followingCursor) seenCursors.add(followingCursor);
          if (response.pageKey) seenPageKeys.add(response.pageKey);
          nextCursor = followingCursor;
          unchangedPages = response.items.length > 0 && added === 0 ? unchangedPages + 1 : 0;
          const noProgress = unchangedPages >= 3;
          complete = response.complete || !nextCursor || reachedStart(oldest, range) || repeatedCursor || repeatedPage || noProgress;
          if (reachedStart(oldest, range)) stopReason = 'start date reached';
          if (repeatedCursor) { stopReason = 'repeated pagination cursor (X returned the same next cursor after a stable page; this usually means the end of this history)'; safePaginationStop = true; }
          if (repeatedPage) { stopReason = 'repeated page content (X returned the same page again; this usually means the end of this history)'; safePaginationStop = true; }
          if (noProgress) { stopReason = 'no new target IDs for three pages (history stopped producing new items)'; safePaginationStop = true; }
          if (page === MAX_PAGES_PER_CATEGORY - 1) { stopReason = 'safety page limit reached'; unsafePaginationStop = true; }
          run.rateLimit = response.rateLimit;
          await store.put('runs', run);
          await progress([...found.values()], `${category}: page ${page + 1}, ${added ? `${added} matching items added` : 'scanning'}${oldest ? `; reached ${oldest.slice(0, 10)}` : ''}`);
          if (!complete) await delay();
        }
        reasons.push(`${category}: ${signal.aborted ? 'cancelled' : stopReason}`);
    }
    await progress([...found.values()], discoveryCompletionMessage(range, reasons, safePaginationStop, unsafePaginationStop, signal.aborted));
    completed = !signal.aborted;
  } finally {
    signal.removeEventListener('abort', cancelRemote);
    if (signal.aborted) cancelRemote();
    run.state = signal.aborted ? 'cancelled' : completed ? 'complete' : 'paused';
    await store.put('runs', run);
  }
}
