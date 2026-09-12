// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { tick } from 'svelte';

it('renders the actual dashboard entry point without extension APIs', async () => {
  document.body.innerHTML = '<div id="app"></div><p id="source-notice">Loading</p>';
  await import('../src/dashboard/main');
  await tick();
  expect(document.querySelector('h1')?.textContent).toContain('XSweep');
  expect(document.body.textContent).toContain('Preview 0 selected');
  expect(document.body.textContent).toContain('Run 0 selected actions');
  expect(document.querySelector('input[aria-label="Select all visible rows"]')).not.toBeNull();
  expect([...document.querySelectorAll('button')].find(button => button.textContent?.includes('Run 0 selected actions'))?.hasAttribute('disabled')).toBe(true);
  expect(document.body.textContent).toContain('must be opened from an installed extension');
  expect(document.getElementById('source-notice')).toBeNull();
});

it('retries automatic connection and finds an inactive X tab', async () => {
  const tab = { id: 42, url: 'https://x.com/home', active: false };
  const query = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([tab]);
  const sendMessage = vi.fn().mockResolvedValue({ ok: true, observation: { account: { id: 'alice', handle: 'alice' } } });
  vi.stubGlobal('chrome', { tabs: { query, get: vi.fn().mockResolvedValue(tab), sendMessage } });
  try {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Try again'))!;
    button.click();
    await vi.waitFor(() => expect(document.body.textContent).toContain('@alice'));
    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true, url: ['https://x.com/*', 'https://twitter.com/*'] });
    expect(query).toHaveBeenCalledWith({ url: ['https://x.com/*', 'https://twitter.com/*'] });
    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'get-account' });
  } finally { vi.unstubAllGlobals(); }
});
