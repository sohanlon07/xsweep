import type { QueueItem } from '../shared/contracts';

export type Category = 'posts' | 'replies' | 'likes';
export function discoveryReadiness(root: Document, path: string, expected: string, category: Category): { error: string; retryable?: boolean } | undefined {
  if (/^\/i\/flow\/(login|challenge)|^\/account\/access/.test(path) || root.querySelector('iframe[src*="captcha"], input[autocomplete="one-time-code"]')) return { error: 'X requires login or challenge verification. Check the X tab.' };
  const handle = signedInHandle(root);
  if (handle && handle.toLowerCase() !== expected.toLowerCase()) return { error: `Signed-in account changed to @${handle}. Reconnect the intended account.` };
  const suffix = category === 'posts' ? '' : category === 'replies' ? '/with_replies' : '/likes';
  const normalizedPath = path.replace(/\/$/, '').toLowerCase();
  const historyLikes = category === 'likes' && normalizedPath === '/i/history/likes';
  if (!historyLikes && normalizedPath !== `/${expected}${suffix}`.toLowerCase()) return { error: `X navigated to ${path} while scanning ${category}. Expected /${expected}${suffix}. Collected results are retained.` };
  if (!handle) return { error: 'Waiting for X to finish rendering account navigation', retryable: true };
  return undefined;
}
export function signedInHandle(root: Document): string | undefined {
  const href = root.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
  return href?.match(/^\/([A-Za-z0-9_]{1,15})\/?$/)?.[1];
}

// Only direct timestamp permalinks identify an enclosing post. Quote cards and
// nested articles must never supply the target identity or action controls.
export function extractItems(root: Document, handle: string, category: Category): QueueItem[] {
  const items = new Map<string, QueueItem>();
  for (const article of root.querySelectorAll('article[data-testid="tweet"]')) {
    if (article.parentElement?.closest('article, [role="link"], [data-testid="quoteTweet"]')) continue;
    if (article.querySelector('[data-testid="placementTracking"], [data-testid="promotedIndicator"]')) continue;
    const own = (element: Element) => {
      if (element.closest('article') !== article) return false;
      // Timestamp anchors themselves have role="link" on X. Only an
      // intervening quote container disqualifies an enclosing post's content.
      for (let ancestor = element.parentElement; ancestor && ancestor !== article; ancestor = ancestor.parentElement) {
        if (ancestor.matches('[data-testid="quoteTweet"], [role="link"]:not(a)')) return false;
      }
      return true;
    };
    const links = [...article.querySelectorAll('a[href*="/status/"]')].filter(a => own(a) && a.querySelector('time'));
    if (links.length !== 1) continue;
    const identity = links[0].getAttribute('href')?.match(/^\/(\w{1,15})\/status\/(\d+)\/?$/);
    if (!identity) continue;
    const [, author, targetId] = identity;
    const control = (name: string) => [...article.querySelectorAll(`[data-testid="${name}"]`)].some(own);
    const owned = author.toLowerCase() === handle.toLowerCase();
    const action = category === 'likes' ? (control('unlike') ? 'unlike' : undefined) : owned ? 'delete_post' : control('unretweet') ? 'undo_repost' : undefined;
    if (!action) continue;
    const timestamp = links[0].querySelector('time')?.getAttribute('datetime');
    const occurredAt = action === 'delete_post' && timestamp && Number.isFinite(Date.parse(timestamp)) ? new Date(timestamp).toISOString() : undefined;
    const id = `${action}:${targetId}`;
    // X's Replies timeline renders a parent post followed by the signed-in
    // user's reply. The reply card often has no "Replying to" label. Parents
    // have already been excluded above because they are not owned by `handle`.
    const kind = action === 'unlike' ? 'like' : action === 'undo_repost' ? 'repost' : category === 'replies' ? 'reply' : 'tweet';
    items.set(id, { id, targetId, action, kind, author, permalink: `https://x.com/${author}/status/${targetId}`, text: [...article.querySelectorAll('[data-testid="tweetText"]')].filter(own).map(e => e.textContent ?? '').join('\n'), source: 'page', selected: false, state: 'pending', occurredAt });
  }
  return [...items.values()];
}
