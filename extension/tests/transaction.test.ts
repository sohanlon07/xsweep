import { describe, expect, it } from 'vitest';
// @vitest-environment jsdom
import { extractIndices, findOnDemandAsset, TransactionIdGenerator } from '../src/content/direct/transaction';

describe('X transaction metadata', () => {
  it('finds X-hosted on-demand assets without a third-party lookup', () => {
    expect(findOnDemandAsset(`window.x={"ondemand.s":"abc123"}`)).toBe('https://abs.twimg.com/responsive-web/client-web/ondemand.s.abc123a.js');
    expect(findOnDemandAsset('<script src="https://abs.twimg.com/responsive-web/client-web/ondemand.s.deadbeefa.js"></script>')).toBe('https://abs.twimg.com/responsive-web/client-web/ondemand.s.deadbeefa.js');
  });

  it('fails closed unless the transaction asset exposes all indices', () => {
    expect(extractIndices('(x[7], 16)(x[2], 16)(x[3], 16)(x[4], 16)')).toEqual({ row: 7, key: [2, 3, 4] });
    expect(extractIndices('(x[7], 16)')).toBeUndefined();
  });

  it('generates deterministic local transaction ids from X page material', async () => {
    const key = btoa(String.fromCharCode(0, 1, 2, 3, 4, 5, 6, 7));
    const rows = Array.from({ length: 16 }, () => '1 2 3 4 5 6 7 8 9 10 11').join('C');
    const frames = Array.from({ length: 4 }, (_, index) => `<div id="loading-x-anim-${index}"><svg><path d="x"/><path d="123456789${rows}"/></svg></div>`).join('');
    const html = `<meta name="twitter-site-verification" content="${key}"><script>window.x={"ondemand.s":"abc123"}</script>${frames}`;
    const generator = await TransactionIdGenerator.create(html, async () => '(x[0], 16)(x[1], 16)(x[2], 16)(x[3], 16)');
    const first = await generator.generate('POST', '/i/api/graphql/id/DeleteTweet', 1_700_000_000_000, 0);
    const second = await generator.generate('POST', '/i/api/graphql/id/DeleteTweet', 1_700_000_000_000, 0);
    expect(first).toBe(second);
    expect(first).toMatch(/^[A-Za-z0-9+/]+$/);
  });
});
