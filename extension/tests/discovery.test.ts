// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { extractItems, signedInHandle, discoveryReadiness } from '../src/content/discovery';

function post(author: string, id: string, extra = '') {
  return `<article data-testid="tweet"><a href="/${author}/status/${id}"><time datetime="2025-01-01T00:00:00Z"></time></a><div data-testid="tweetText">outer text</div>${extra}</article>`;
}
describe('visible history extraction', () => {
  it('accepts the redirected Likes history route only for the bound account', () => {
    document.body.innerHTML = '<a data-testid="AppTabBar_Profile_Link" href="/alice">Profile</a>';
    expect(discoveryReadiness(document, '/i/history/likes', 'alice', 'likes')).toBeUndefined();
    expect(discoveryReadiness(document, '/i/history/likes', 'bob', 'likes')?.error).toContain('changed to @alice');
    expect(discoveryReadiness(document, '/i/history/likes', 'alice', 'posts')?.error).toContain('navigated');
  });
  it('retries missing account navigation but stops on confirmed account changes', () => {
    document.body.innerHTML = '';
    expect(discoveryReadiness(document, '/alice', 'alice', 'posts')?.retryable).toBe(true);
    document.body.innerHTML = '<a data-testid="AppTabBar_Profile_Link" href="/alice">Profile</a>';
    expect(discoveryReadiness(document, '/alice', 'alice', 'posts')).toBeUndefined();
    expect(discoveryReadiness(document, '/bob', 'bob', 'posts')).toMatchObject({ error: expect.stringContaining('changed to @alice') });
    expect(discoveryReadiness(document, '/bob', 'bob', 'posts')?.retryable).toBeUndefined();
  });
  it('does not retry login challenges or navigation to another category', () => {
    document.body.innerHTML = '';
    expect(discoveryReadiness(document, '/i/flow/login', 'alice', 'posts')?.retryable).toBeUndefined();
    expect(discoveryReadiness(document, '/alice/likes', 'alice', 'posts')).toMatchObject({ error: expect.stringContaining('navigated to /alice/likes') });
  });
  it('accepts timestamp anchors with role=link but excludes quote containers', () => {
    document.body.innerHTML = `<article data-testid="tweet" role="article">
      <a role="link" href="/alice/status/123"><time datetime="2025-01-01T00:00:00Z"></time></a>
      <div data-testid="tweetText">My post</div>
      <div role="link"><a role="link" href="/bob/status/456"><time></time></a><div data-testid="tweetText">Quote</div></div>
    </article>`;
    expect(extractItems(document, 'alice', 'posts')).toEqual([
      expect.objectContaining({ targetId: '123', text: 'My post', action: 'delete_post' })
    ]);
  });
  it('reads identity from the profile navigation, not arbitrary avatars', () => {
    document.body.innerHTML = '<a href="/other"><img></a><a data-testid="AppTabBar_Profile_Link" href="/alice">Profile</a>';
    expect(signedInHandle(document)).toBe('alice');
  });
  it('excludes unrelated authors and promoted items', () => {
    document.body.innerHTML = post('alice', '1') + post('bob', '2') + post('alice', '3', '<span data-testid="promotedIndicator"></span>');
    expect(extractItems(document, 'alice', 'posts').map(i => i.targetId)).toEqual(['1']);
  });
  it('uses the outer timestamp and ignores quoted text and controls', () => {
    const quote = '<div role="link"><a href="/bob/status/99"><time></time></a><div data-testid="tweetText">quote</div><button data-testid="unlike"></button></div>';
    document.body.innerHTML = post('alice', '1', quote);
    expect(extractItems(document, 'alice', 'posts')[0]).toMatchObject({ targetId: '1', text: 'outer text', selected: false });
    expect(extractItems(document, 'alice', 'likes')).toEqual([]);
  });
  it('requires active likes/reposts and never uses post dates as action dates', () => {
    document.body.innerHTML = post('bob', '2', '<button data-testid="unlike"></button><button data-testid="unretweet"></button>');
    expect(extractItems(document, 'alice', 'likes')[0]).toMatchObject({ action: 'unlike', occurredAt: undefined });
    expect(extractItems(document, 'alice', 'posts')[0]).toMatchObject({ action: 'undo_repost', targetId: '2', occurredAt: undefined });
  });
  it('labels owned cards on the replies timeline as replies without relying on visible English text', () => {
    document.body.innerHTML = post('bob', '9') + post('alice', '1') + post('alice', '2', '<div dir="ltr">Replying to @bob</div>');
    expect(extractItems(document, 'alice', 'replies').map(i => i.kind)).toEqual(['reply', 'reply']);
  });
  it('deduplicates posts and rejects ambiguous timestamp identities', () => {
    document.body.innerHTML = post('alice', '1') + post('alice', '1') + post('alice', '2', '<a href="/bob/status/3"><time></time></a>');
    expect(extractItems(document, 'alice', 'replies').map(i => i.id)).toEqual(['delete_post:1']);
  });
});
