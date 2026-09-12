import { describe, expect, it } from 'vitest';
import { parseEntry } from '../src/archive/parser';
import { parseTimeline } from '../src/content/direct/api';

const account = { id: '42', handle: 'alice' };
const timeline = (result: object) => ({ data: { user: { result: { timeline: { timeline: { instructions: [
  { entries: [{ entryId: 'tweet-1', content: { itemContent: { tweet_results: { result } } } }] }
] } } } } } });
const directPost = (id: string, text: string, reply = false) => ({ rest_id: id, core: { user_results: { result: { core: { screen_name: 'alice' } } } }, legacy: { id_str: id, full_text: text, created_at: '2025-02-03T10:00:00Z', ...(reply ? { in_reply_to_user_id_str: '99' } : {}) } });

describe('archive and direct discovery fixtures', () => {
  it('normalizes equivalent originals, replies, and likes to the same review actions', () => {
    const archivePost = parseEntry('data/tweets.js', '[{"tweet":{"id_str":"101","full_text":"original","created_at":"2025-02-03T10:00:00Z"}}]')[0];
    const archiveReply = parseEntry('data/tweets.js', '[{"tweet":{"id_str":"102","full_text":"reply","in_reply_to_status_id_str":"99","created_at":"2025-02-03T10:00:00Z"}}]')[0];
    const archiveLike = parseEntry('data/like.js', '[{"like":{"tweetId":"103","fullText":"liked"}}]')[0];
    const directOriginal = parseTimeline(timeline(directPost('101', 'original')), 'posts', account)[0];
    const directReply = parseTimeline(timeline(directPost('102', 'reply', true)), 'replies', account)[0];
    const directLike = parseTimeline(timeline({ ...directPost('103', 'liked'), legacy: { id_str: '103', full_text: 'liked', favorited: true } }), 'likes', account)[0];
    expect([archivePost, archiveReply, archiveLike].map(item => [item.action, item.kind, item.targetId])).toEqual([
      [directOriginal.action, directOriginal.kind, directOriginal.targetId],
      [directReply.action, directReply.kind, directReply.targetId],
      [directLike.action, directLike.kind, directLike.targetId]
    ]);
    expect(archiveLike.occurredAt).toBeUndefined();
    expect(directLike.occurredAt).toBeUndefined();
  });
});
