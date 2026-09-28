// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { pageIndicatesMissingPost } from '../src/content/direct/page-check';

describe('independent X page readback', () => {
  it('recognizes the explicit missing page shown by X', () => {
    document.body.innerHTML = '<main>Hmm...this page doesn’t exist. Try searching for something else.</main>';
    expect(pageIndicatesMissingPost(document, '123')).toBe(true);
  });

  it('does not treat a visible target or a generic page as missing', () => {
    document.body.innerHTML = '<main><article data-testid="tweet"><a href="/alice/status/123">Post</a></article>This page doesn’t exist</main>';
    expect(pageIndicatesMissingPost(document, '123')).toBe(false);
    document.body.innerHTML = '<main>Something went wrong. Try again.</main>';
    expect(pageIndicatesMissingPost(document, '123')).toBe(false);
  });
});
