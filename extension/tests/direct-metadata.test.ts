import { describe, expect, it } from 'vitest';
import { extractOperationMetadata, featureValues, mainBundleUrls, metadataRevision } from '../src/content/direct/metadata';
import { allowedXAssetUrl } from '../src/shared/x-assets';

describe('direct X metadata', () => {
  it('extracts only allowlisted operations and valid query ids', () => {
    const source = `
      {queryId:"abcde123",operationName:"Likes",operationType:"query",metadata:{featureSwitches:["one","two"]}}
      {queryId:"delete_123",operationName:"DeleteTweet",operationType:"mutation",metadata:{featureSwitches:[]}}
      {queryId:"abcde123",operationName:"ArbitraryOperation",operationType:"query",metadata:{featureSwitches:["bad"]}}
    `;
    const metadata = extractOperationMetadata(source);
    expect(metadata.Likes).toEqual({ queryId: 'abcde123', features: ['one', 'two'] });
    expect(metadata.DeleteTweet).toEqual({ queryId: 'delete_123', features: [] });
    expect(metadata).not.toHaveProperty('ArbitraryOperation');
    expect(featureValues(metadata.Likes!, { one: true })).toEqual({ one: true, two: false });
    expect(metadataRevision(metadata)).toContain('Likes:abcde123');
  });

  it('accepts only current X main-bundle asset URLs', () => {
    const html = `<script src="https://abs.twimg.com/responsive-web/client-web/main.abc123.js"></script><script src="https://evil.example/main.bad.js"></script>`;
    expect(mainBundleUrls(html)).toEqual(['https://abs.twimg.com/responsive-web/client-web/main.abc123.js']);
    expect(allowedXAssetUrl('https://abs.twimg.com/responsive-web/client-web/main.abc123.js')?.href).toBe('https://abs.twimg.com/responsive-web/client-web/main.abc123.js');
    expect(allowedXAssetUrl('https://abs.twimg.com/responsive-web/client-web/ondemand.s.abc123a.js')?.href).toBe('https://abs.twimg.com/responsive-web/client-web/ondemand.s.abc123a.js');
    expect(allowedXAssetUrl('https://abs.twimg.com/other.js')).toBeUndefined();
    expect(allowedXAssetUrl('https://evil.example/responsive-web/client-web/main.abc123.js')).toBeUndefined();
    expect(allowedXAssetUrl('https://abs.twimg.com/responsive-web/client-web/main.abc123.js?redirect=evil')).toBeUndefined();
  });
});
