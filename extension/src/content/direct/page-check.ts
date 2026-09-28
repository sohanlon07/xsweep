export function pageIndicatesMissingPost(root: Document, targetId: string): boolean {
  if (!/^\d+$/.test(targetId)) return false;
  const main = root.querySelector('main');
  if (!main || main.querySelector(`article[data-testid="tweet"] a[href$="/status/${targetId}"]`)) return false;
  return /(?:this page doesn.t exist|this post is unavailable)/i.test(main.textContent ?? '');
}
