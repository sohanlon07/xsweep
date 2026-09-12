export const OPERATIONS = ['UserByScreenName', 'UserTweetsAndReplies', 'Likes', 'DeleteTweet', 'DeleteRetweet', 'UnfavoriteTweet', 'TweetResultByRestId'] as const;
export type OperationName = typeof OPERATIONS[number];
export interface OperationMetadata { queryId: string; features: string[] }
export type MetadataMap = Partial<Record<OperationName, OperationMetadata>>;

const operationSet = new Set<string>(OPERATIONS);

export function extractOperationMetadata(source: string): MetadataMap {
  const result: MetadataMap = {};
  const pattern = /queryId:\s*["']([^"']+)["'],\s*operationName:\s*["']([^"']+)["'][\s\S]{0,3000}?featureSwitches:\s*\[([^\]]*)\]/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[2] as OperationName;
    if (!operationSet.has(name)) continue;
    const features = [...match[3].matchAll(/["']([^"']+)["']/g)].map(value => value[1]);
    if (/^[A-Za-z0-9_-]{5,120}$/.test(match[1])) result[name] = { queryId: match[1], features };
  }
  return result;
}

export function mainBundleUrls(html: string, base = 'https://x.com/'): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(/(?:src|href)=["']([^"']*\/responsive-web\/client-web\/main\.[^"']+\.js)["']/g)) {
    try {
      const url = new URL(match[1], base);
      if (url.protocol === 'https:' && url.hostname === 'abs.twimg.com') urls.add(url.href);
    } catch { /* Ignore malformed asset references. */ }
  }
  return [...urls];
}

export function featureValues(metadata: OperationMetadata, defaults: Record<string, boolean>): Record<string, boolean> {
  return Object.fromEntries(metadata.features.map(name => [name, defaults[name] ?? false]));
}

export function metadataRevision(metadata: MetadataMap): string {
  return OPERATIONS.map(name => `${name}:${metadata[name]?.queryId ?? '-'}`).join('|');
}
