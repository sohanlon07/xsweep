import type { Category } from '../content/discovery';
import type { Account, QueueItem, Run } from '../shared/contracts';
import { store } from '../storage/db';

export async function discover(tabId: number, account: Account, limits: Record<Category, number>, signal: AbortSignal, progress: (items: QueueItem[], detail: string) => Promise<void>) {
  if (!/^[A-Za-z0-9_]{1,15}$/.test(account.handle) || Object.values(limits).some(n => !Number.isInteger(n) || n < 0 || n > 1000)) throw new Error('Category limits must be whole numbers from 0 to 1000.');
  const run: Run = { id: crypto.randomUUID(), revision: 1, tabId, account, itemIds: [], dryRun: true, state: 'active', nextEligibleAt: 0 };
  if (!await store.claim(run)) throw new Error('Another discovery or cleanup run is active.');
  const found = new Map<string, QueueItem>();
  const reasons: string[] = [];
  const delay = () => new Promise<void>(resolve => { const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }; const timer = setTimeout(done, 1500); signal.addEventListener('abort', done, { once: true }); if (signal.aborted) done(); });
  try {
    for (const category of ['posts', 'replies', 'likes'] as Category[]) {
      if (signal.aborted) break;
      if (!limits[category]) continue;
      await progress([...found.values()], `Starting ${category}… Keep the connected X tab open; Tweet Cleaner is controlling it.`);
      const suffix = category === 'posts' ? '' : category === 'replies' ? '/with_replies' : '/likes';
      const expectedPath = `/${account.handle}${suffix}`;
      await chrome.tabs.update(tabId, { url: `https://x.com${expectedPath}`, active: true });
      // Wait for a full navigation before messaging the newly injected script.
      let loaded = false;
      let actualUrl = '';
      for (let wait = 0; wait < 20 && !signal.aborted; wait++) {
        await delay();
        const tab = await chrome.tabs.get(tabId);
        actualUrl = tab.url ?? '';
        if (tab.status === 'complete' && matchesDiscoveryPage(actualUrl, expectedPath)) { loaded = true; break; }
      }
      if (signal.aborted) break;
      if (!loaded) { reasons.push(`${category}: could not load ${expectedPath}; X reached ${actualUrl || 'an unavailable tab'}. Earlier results retained.`); break; }
      const seen = new Set<string>(); let stalled = 0; let readinessRetries = 0;
      let reason = 'scroll limit reached';
      for (let scroll = 0; scroll < 600 && !signal.aborted; scroll++) {
        const response = await chrome.tabs.sendMessage(tabId, { type: 'discover-page', category, handle: account.handle }) as { error?: string; retryable?: boolean; items?: QueueItem[]; articles?: number };
        if (response?.retryable && response.error) {
          if (++readinessRetries > 20) throw new Error('Account navigation did not become available within 30 seconds. Check the X tab and retry discovery.');
          await progress([...found.values()], `${category}: ${seen.size}/${limits[category]} — ${response.error}`);
          await delay();
          scroll--; // Rendering waits do not consume the scroll budget.
          continue;
        }
        if (response?.error || !Array.isArray(response?.items)) throw new Error(response?.error ?? 'Discovery page did not respond');
        readinessRetries = 0;
        if (signal.aborted) break;
        const before = seen.size;
        for (const item of response.items) { if (seen.size >= limits[category]) break; seen.add(item.id); found.set(item.id, item); }
        await progress([...found.values()], `${category}: ${seen.size}/${limits[category]} — ${response.articles ?? 0} post cards visible${!seen.size ? ', waiting for matching posts' : ' — partial visible history'}`);
        if (seen.size >= limits[category]) { reason = 'item limit reached'; break; }
        stalled = seen.size === before ? stalled + 1 : 0;
        if (stalled >= 30) {
          reason = seen.size ? 'loading stalled or no more visible items' : response.articles ? 'post cards visible but no eligible targets matched; page structure or ownership needs checking' : 'no post cards loaded; page may be empty, restricted, or unavailable';
          break;
        }
        await delay();
      }
      reasons.push(`${category}: ${reason}`);
    }
    await progress([...found.values()], signal.aborted ? 'Cancelled — partial results retained.' : `Partial results. ${reasons.join('; ')}`);
  } finally {
    run.state = signal.aborted ? 'cancelled' : 'complete';
    await store.put('runs', run);
  }
}

export function matchesDiscoveryPage(url: string, path: string): boolean {
  try {
    const parsed = new URL(url);
    const actualPath = parsed.pathname.replace(/\/$/, '').toLowerCase();
    const allowedPath = actualPath === path.toLowerCase() || (/^\/\w{1,15}\/likes$/.test(path) && actualPath === '/i/history/likes');
    return parsed.protocol === 'https:' && ['x.com', 'twitter.com'].includes(parsed.hostname) && allowedPath;
  } catch { return false; }
}
