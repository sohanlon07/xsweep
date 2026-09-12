// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { mutationRequest, nonJsonResponseError, parseTimeline, readCookie, resultUnavailable, timelinePageKey, validMutationResponse, validSessionHeader } from '../src/content/direct/api';

const account = { id: '42', handle: 'alice' };
const entry = (result: object) => ({ data: { user: { result: { timeline: { timeline: { instructions: [{ entries: [{ entryId: 'tweet-1', content: { itemContent: { tweet_results: { result } } } }] }] } } } } } });

describe('direct X request boundaries', () => {
  it('accepts only bounded session header shapes and reads only the named cookie', () => {
    expect(validSessionHeader('authorization', `Bearer ${'a'.repeat(30)}`)).toBe(true);
    expect(validSessionHeader('authorization', 'Basic secret')).toBe(false);
    expect(validSessionHeader('x-client-uuid', '12345678-1234-1234-1234-123456789abc')).toBe(true);
    expect(readCookie('ct0', 'auth_token=hidden; ct0=csrf-value')).toBe('csrf-value');
  });

  it('constructs only the three fixed mutation payloads', () => {
    expect(mutationRequest('delete_post', '123')).toEqual({ operation: 'DeleteTweet', variables: { tweet_id: '123', dark_request: false } });
    expect(mutationRequest('undo_repost', '123')).toEqual({ operation: 'DeleteRetweet', variables: { source_tweet_id: '123' } });
    expect(mutationRequest('unlike', '123')).toEqual({ operation: 'UnfavoriteTweet', variables: { tweet_id: '123' } });
    expect(() => mutationRequest('unlike', '../bad')).toThrow('Invalid target ID');
  });

  it('validates fixed mutation response envelopes and any returned target id', () => {
    expect(validMutationResponse('delete_post', '123', { data: { delete_tweet: { tweet_results: {} } } })).toBe(true);
    expect(validMutationResponse('delete_post', '123', { data: { delete_tweet: { tweet_results: { result: { rest_id: '123' } } } } })).toBe(true);
    expect(validMutationResponse('delete_post', '123', { data: { delete_tweet: { tweet_results: { result: { rest_id: '999' } } } } })).toBe(false);
    expect(validMutationResponse('undo_repost', '123', { data: { unretweet: { source_tweet_results: { result: { rest_id: '123' } } } } })).toBe(true);
    expect(validMutationResponse('unlike', '123', { data: { unfavorite_tweet: 'Done' } })).toBe(true);
    expect(validMutationResponse('unlike', '123', { data: { unfavorite_tweet: 'Maybe' } })).toBe(false);
    expect(validMutationResponse('delete_post', '123', { data: {} })).toBe(false);
  });

  it('does not mistake a missing exact-post result for a deleted target', () => {
    expect(resultUnavailable(undefined)).toBe(false);
    expect(resultUnavailable({ __typename: 'TweetTombstone' })).toBe(true);
  });

  it('turns non-JSON X pages into safe, actionable diagnostics', () => {
    expect(nonJsonResponseError(200, 'text/html', '<html>Log in to X</html>').message).toContain('sign-in or challenge');
    expect(nonJsonResponseError(502, 'text/html', '<html>temporary error</html>').message).toContain('unexpected HTML page');
  });

  it('normalizes API posts and likes into the existing review queue', () => {
    const result = { rest_id: '123', core: { user_results: { result: { core: { screen_name: 'alice' } } } }, legacy: { id_str: '123', full_text: 'hello', created_at: '2024-01-02T03:04:05Z', favorited: true } };
    expect(parseTimeline(entry(result), 'posts', account)[0]).toMatchObject({ action: 'delete_post', kind: 'tweet', targetId: '123', occurredAt: '2024-01-02T03:04:05.000Z' });
    expect(parseTimeline(entry(result), 'likes', account)[0]).toMatchObject({ action: 'unlike', kind: 'like', targetId: '123', occurredAt: undefined });
  });

  it('strictly filters original posts and replies after X returns a mixed timeline', () => {
    const original = { rest_id: '123', core: { user_results: { result: { core: { screen_name: 'alice' } } } }, legacy: { id_str: '123', full_text: 'post' } };
    const reply = { rest_id: '456', core: { user_results: { result: { core: { screen_name: 'alice' } } } }, legacy: { id_str: '456', full_text: 'reply', in_reply_to_user_id_str: '99' } };
    expect(parseTimeline(entry(original), 'replies', account)).toEqual([]);
    expect(parseTimeline(entry(reply), 'posts', account)).toEqual([]);
    expect(parseTimeline(entry(reply), 'replies', account)[0]).toMatchObject({ targetId: '456', kind: 'reply' });
  });

  it('produces a stable page key for repeat-pagination detection', () => {
    const result = { rest_id: '123', legacy: { id_str: '123' } };
    expect(timelinePageKey(entry(result))).toBe('123');
  });
});
