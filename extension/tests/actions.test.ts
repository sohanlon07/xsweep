// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mutateAction, observeAction } from '../src/content/actions';

const account = { id: 'alice', handle: 'alice' };

function ownedPost(id = '123') {
  document.body.innerHTML = `<article data-testid="tweet"><a href="/alice/status/${id}"><time></time></a><button data-testid="caret">More</button></article>`;
  return document.querySelector<HTMLElement>('[data-testid="caret"]')!;
}

describe('target-scoped X actions', () => {
  it('waits for X to render the delete menu and confirmation before verifying removal', async () => {
    const caret = ownedPost();
    caret.addEventListener('click', () => setTimeout(() => {
      const menu = document.createElement('div');
      menu.setAttribute('role', 'menuitem');
      menu.textContent = 'Delete';
      menu.addEventListener('click', () => setTimeout(() => {
        // X does not consistently expose a role=dialog wrapper around this
        // sheet, so the stable confirmation test id must be sufficient.
        const dialog = document.createElement('div');
        dialog.setAttribute('data-testid', 'confirmationSheetDialog');
        dialog.innerHTML = '<p>Delete post?</p><button data-testid="confirmationSheetConfirm" disabled>Delete</button>';
        const confirmation = dialog.querySelector('button')!;
        confirmation.addEventListener('click', () => setTimeout(() => {
          document.querySelector('article')?.remove();
          dialog.remove();
        }, 20));
        document.body.append(dialog);
        setTimeout(() => confirmation.removeAttribute('disabled'), 30);
      }, 20));
      document.body.append(menu);
    }, 20));

    await expect(mutateAction(document, '123', 'delete_post', account)).resolves.toMatchObject({ state: 'inactive' });
    expect(document.querySelector('article')).toBeNull();
  });

  it('refuses to open the menu when the exact post belongs to another account', async () => {
    const caret = ownedPost();
    const click = vi.spyOn(caret, 'click');
    const result = await mutateAction(document, '123', 'delete_post', { id: 'bob', handle: 'bob' });
    expect(result).toMatchObject({ state: 'ambiguous', detail: expect.stringContaining('not owned') });
    expect(click).not.toHaveBeenCalled();
  });

  it('waits until an unlike action becomes inactive', async () => {
    document.body.innerHTML = '<article data-testid="tweet"><a href="/bob/status/456"><time></time></a><button data-testid="unlike">Unlike</button></article>';
    const unlike = document.querySelector<HTMLElement>('[data-testid="unlike"]')!;
    unlike.addEventListener('click', () => setTimeout(() => unlike.setAttribute('data-testid', 'like'), 20));
    expect(observeAction(document, '456', 'unlike', account).state).toBe('active');
    await expect(mutateAction(document, '456', 'unlike', account)).resolves.toMatchObject({ state: 'inactive' });
  });
});
