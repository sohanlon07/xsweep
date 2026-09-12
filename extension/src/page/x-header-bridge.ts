const EVENT = 'tweet-cleaner:x-session-header';

function publish(name: string, value: string): void {
  const lower = name.toLowerCase();
  if (lower !== 'authorization' && lower !== 'x-client-uuid') return;
  document.dispatchEvent(new CustomEvent(EVENT, { detail: { name: lower, value } }));
}

function inspect(headers?: HeadersInit): void {
  if (!headers) return;
  try {
    const normalized = new Headers(headers);
    for (const name of ['authorization', 'x-client-uuid']) {
      const value = normalized.get(name);
      if (value) publish(name, value);
    }
  } catch {
    // X owns the request. Invalid or opaque headers are irrelevant to the bridge.
  }
}

const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
XMLHttpRequest.prototype.setRequestHeader = function(name: string, value: string): void {
  publish(name, value);
  return originalSetRequestHeader.call(this, name, value);
};

const originalFetch = window.fetch;
window.fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (input instanceof Request) inspect(input.headers);
  inspect(init?.headers);
  return originalFetch.call(this, input, init);
};
