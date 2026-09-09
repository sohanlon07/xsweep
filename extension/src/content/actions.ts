import type { Account, Action, Observation } from '../shared/contracts';

const statusPath = (id: string) => new RegExp(`^/([A-Za-z0-9_]{1,15})/status/${id}/?$`, 'i');

function isDirectContent(element: Element, article: HTMLElement): boolean {
  if (element.closest('article') !== article) return false;
  for (let parent = element.parentElement; parent && parent !== article; parent = parent.parentElement) {
    if (parent.matches('[data-testid="quoteTweet"], [role="link"]:not(a)')) return false;
  }
  return true;
}

export function findTargetArticle(root: Document, id: string): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>('article[data-testid="tweet"], article')].find(article =>
    [...article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')]
      .some(link => isDirectContent(link, article) && statusPath(id).test(new URL(link.href, location.href).pathname))
  );
}

function targetAuthor(article: HTMLElement, id: string): string | undefined {
  for (const link of article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')) {
    if (!isDirectContent(link, article)) continue;
    const match = new URL(link.href, location.href).pathname.match(statusPath(id));
    if (match) return match[1];
  }
}

export function observeAction(root: Document, id: string, action: Action, account?: Account): Observation {
  const target = findTargetArticle(root, id);
  if (!target) return { targetId: id, state: 'not_found', account };
  if (action === 'delete_post') {
    const author = targetAuthor(target, id);
    if (!account || !author || author.toLowerCase() !== account.handle.toLowerCase()) {
      return { targetId: id, state: 'ambiguous', account, detail: 'The exact target is not owned by the connected account.' };
    }
    if (!target.querySelector('[data-testid="caret"]')) return { targetId: id, state: 'ambiguous', account, detail: 'The target menu control is unavailable.' };
    return { targetId: id, state: 'active', account };
  }
  const activeSelector = action === 'unlike' ? '[data-testid="unlike"]' : '[data-testid="unretweet"]';
  return { targetId: id, state: target.querySelector(activeSelector) ? 'active' : 'inactive', account };
}

async function waitFor<T>(read: () => T | undefined, timeout = 8000): Promise<T | undefined> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

function normalizedText(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function isUsableControl(element: HTMLElement): boolean {
  return element.getAttribute('aria-disabled') !== 'true'
    && !element.hasAttribute('disabled')
    && !element.closest('[aria-hidden="true"]');
}

function deleteConfirmation(root: Document, existing: Set<Element>): HTMLElement | undefined {
  const xConfirmation = [...root.querySelectorAll<HTMLElement>('[data-testid="confirmationSheetConfirm"]')]
    .find(button => !existing.has(button) && normalizedText(button) === 'Delete' && isUsableControl(button));
  if (xConfirmation) return xConfirmation;

  // Keep a semantic fallback for compatible X variants, but require both the
  // dialog context and an exact destructive button label.
  return [...root.querySelectorAll<HTMLElement>('[role="dialog"]')]
    .filter(dialog => /delete/i.test(normalizedText(dialog)))
    .flatMap(dialog => [...dialog.querySelectorAll<HTMLElement>('button, [role="button"]')])
    .find(button => !existing.has(button) && normalizedText(button) === 'Delete' && isUsableControl(button));
}

export async function mutateAction(root: Document, id: string, action: Action, account?: Account): Promise<Observation> {
  const before = observeAction(root, id, action, account);
  if (before.state !== 'active') return before;
  const target = findTargetArticle(root, id)!;
  if (action !== 'delete_post') {
    const selector = action === 'unlike' ? '[data-testid="unlike"]' : '[data-testid="unretweet"]';
    target.querySelector<HTMLElement>(selector)!.click();
    const verified = await waitFor(() => observeAction(root, id, action, account).state === 'inactive' ? true : undefined);
    return verified ? { targetId: id, state: 'inactive', account } : { targetId: id, state: 'ambiguous', account, detail: 'The active state did not clear after the click.' };
  }

  const existingChoices = new Set(root.querySelectorAll('[role="menuitem"], [data-testid="Dropdown"]'));
  const existingConfirmations = new Set(root.querySelectorAll('[data-testid="confirmationSheetConfirm"], [role="dialog"] button, [role="dialog"] [role="button"]'));
  target.querySelector<HTMLElement>('[data-testid="caret"]')!.click();
  const remove = await waitFor(() => [...root.querySelectorAll<HTMLElement>('[role="menuitem"], [data-testid="Dropdown"]')]
    .find(element => !existingChoices.has(element) && normalizedText(element) === 'Delete'));
  if (!remove) return { targetId: id, state: 'ambiguous', account, detail: 'The Delete menu item did not appear.' };
  remove.click();

  const confirmation = await waitFor(() => deleteConfirmation(root, existingConfirmations));
  if (!confirmation) return { targetId: id, state: 'ambiguous', account, detail: 'The target-specific Delete confirmation did not appear.' };
  confirmation.focus();
  confirmation.click();

  const removed = await waitFor(() => !findTargetArticle(root, id) && !root.querySelector('[role="dialog"]') ? true : undefined, 12000);
  return removed
    ? { targetId: id, state: 'inactive', account, detail: 'The exact target disappeared after confirmation.' }
    : { targetId: id, state: 'ambiguous', account, detail: 'Deletion could not be positively verified.' };
}
