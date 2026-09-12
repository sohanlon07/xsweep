export type Category = 'posts' | 'replies' | 'likes';

export function signedInHandle(root: Document): string | undefined {
  const href = root.querySelector('a[data-testid="AppTabBar_Profile_Link"]')?.getAttribute('href');
  return href?.match(/^\/([A-Za-z0-9_]{1,15})\/?$/)?.[1];
}
