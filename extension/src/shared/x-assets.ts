export const MAX_X_ASSET_BYTES = 16 * 1024 * 1024;

export function allowedXAssetUrl(value: unknown): URL | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'abs.twimg.com') return undefined;
    if (!/^\/responsive-web\/client-web\/(?:main\.[A-Za-z0-9_-]+\.js|ondemand\.s\.[A-Za-z0-9_-]+a\.js)$/.test(url.pathname)) return undefined;
    if (url.username || url.password || url.port || url.search || url.hash) return undefined;
    return url;
  } catch {
    return undefined;
  }
}
