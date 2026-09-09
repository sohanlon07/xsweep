import type { QueueItem } from '../shared/contracts';

export function targetUrl(item: QueueItem): string {
  return item.permalink && /^https:\/\/(x|twitter)\.com\/\w{1,15}\/status\/\d+\/?$/i.test(item.permalink)
    ? item.permalink
    : `https://x.com/i/web/status/${item.targetId}`;
}

export function isTargetPage(url: string, targetId: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ['x.com', 'twitter.com'].includes(parsed.hostname) && new RegExp(`/status/${targetId}(?:/|$)`).test(parsed.pathname);
  } catch { return false; }
}

export async function openTarget(tabId: number, item: QueueItem): Promise<boolean> {
  await chrome.tabs.update(tabId, { url: targetUrl(item), active: true });
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete' && isTargetPage(tab.url ?? '', item.targetId)) return true;
  }
  return false;
}
