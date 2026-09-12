import { isMessage, type ContentResponse } from '../shared/messages';
import type { Account } from '../shared/contracts';
import { signedInHandle } from './discovery';
import { DirectXTransport, directError } from './direct/api';

const direct = new DirectXTransport(document);

document.addEventListener('tweet-cleaner:x-session-header', event => {
  const detail = (event as CustomEvent<unknown>).detail;
  if (!detail || typeof detail !== 'object') return;
  const { name, value } = detail as Record<string, unknown>;
  if (typeof name === 'string' && typeof value === 'string') direct.capture(name, value);
});

const bridge = document.createElement('script');
bridge.src = chrome.runtime.getURL('x-header-bridge.js');
bridge.onload = () => bridge.remove();
function installBridge() {
  const parent = document.head ?? document.documentElement;
  if (parent) parent.appendChild(bridge);
  else {
    const observer = new MutationObserver(() => {
      const available = document.head ?? document.documentElement;
      if (available) { observer.disconnect(); available.appendChild(bridge); }
    });
    observer.observe(document, { childList: true, subtree: true });
  }
}
installBridge();

function pageAccount(): Account | undefined {
  const handle = signedInHandle(document);
  return handle ? { id: handle.toLowerCase(), handle } : undefined;
}

chrome.runtime.onMessage.addListener((raw, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !isMessage(raw)) {
    respond({ ok: false, error: 'Invalid message' } satisfies ContentResponse); return;
  }
  if (raw.type === 'get-account') {
    respond({ ok: true, observation: { targetId: 'account', state: 'active', account: pageAccount() } } satisfies ContentResponse); return;
  }
  if (raw.type === 'cancel') {
    direct.cancel(raw.runId);
    respond({ ok: true, cancelled: true } satisfies ContentResponse); return;
  }
  void (async () => {
    try {
      if (raw.type === 'probe') {
        respond({ ok: true, ...await direct.probe() } satisfies ContentResponse); return;
      }
      if (raw.type === 'direct-discover') {
        const probe = await direct.probe();
        if (!probe.account || probe.capability.state !== 'ready') throw new Error(probe.capability.detail);
        if (probe.account.handle.toLowerCase() !== raw.handle.toLowerCase()) throw new Error('The signed-in X account changed.');
        respond({ ok: true, ...await direct.discover(raw.runId, raw.category, probe.account, raw.cursor) } satisfies ContentResponse); return;
      }
      const currentAccount: Account = { id: raw.accountId, handle: raw.accountHandle };
      const result = raw.type === 'inspect'
        ? await direct.inspect(raw.runId, raw.targetId, raw.action, currentAccount)
        : await direct.mutate(raw.runId, raw.targetId, raw.action, currentAccount);
      respond({ ok: true, ...result } satisfies ContentResponse);
    } catch (error) {
      respond({ ok: false, ...directError(error) } satisfies ContentResponse);
    }
  })();
  return true;
});
