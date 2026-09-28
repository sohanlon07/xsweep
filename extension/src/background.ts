import { store } from './storage/db';
import { allowedXAssetUrl, MAX_X_ASSET_BYTES } from './shared/x-assets';
import { interruptRunForClosedTab, runAuthorizesOperation } from './shared/run-guards';
import type { Run } from './shared/contracts';
function configureSidePanel() {
  return chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
}
const RUNTIME_HISTORY_MARKER = 'tweet-cleaner-history-initialized';
async function interruptRunsAfterRuntimeReload() {
  const marker = await chrome.storage.session.get(RUNTIME_HISTORY_MARKER);
  if (marker[RUNTIME_HISTORY_MARKER]) return;
  for (const run of await store.all<Run>('runs')) {
    if (run.state === 'active') await store.put('runs', { ...run, state: 'interrupted' });
  }
  await chrome.storage.session.set({ [RUNTIME_HISTORY_MARKER]: true });
}
// Configure before the first toolbar click when Chrome starts or the extension
// is reloaded, rather than making the first click do setup work.
void configureSidePanel();
void interruptRunsAfterRuntimeReload();
chrome.runtime.onInstalled.addListener(() => { void (async () => { await interruptRunsAfterRuntimeReload(); await configureSidePanel(); })(); });
chrome.runtime.onStartup.addListener(() => { void configureSidePanel(); });
chrome.runtime.onConnect.addListener(port => { if (port.name !== 'dashboard') return; port.onDisconnect.addListener(() => { void interrupt(); }); });
chrome.tabs.onRemoved.addListener(tabId => { void (async()=>{const interrupted=interruptRunForClosedTab(await store.activeRun(),tabId);if(interrupted)await store.put('runs',interrupted);})(); });
async function interrupt(){const r=await store.activeRun();if(r?.state==='active'){try{await chrome.tabs.sendMessage(r.tabId,{type:'cancel',runId:r.id,attemptId:r.activeAttemptId});}catch{/* The stored interruption still prevents new routed work. */}r.state='interrupted';await store.put('runs',r);}}
async function verifyMissingPost(targetId: string, accountHandle: string): Promise<boolean> {
  const tab = await chrome.tabs.create({ url: `https://x.com/${accountHandle}/status/${targetId}`, active: false });
  if (tab.id === undefined) return false;
  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const result = await chrome.tabs.sendMessage(tab.id, { type: 'page-state', targetId, accountHandle }) as { ok?: boolean; missing?: boolean };
        if (result?.ok && result.missing) return true;
      } catch { /* The content script may not have loaded yet. */ }
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
    return false;
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => undefined);
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'verify-missing-post') {
    void (async () => {
      const { runId, targetId, accountHandle } = message;
      const run = typeof runId === 'string' ? await store.get<Run>('runs', runId) : undefined;
      if (!run || sender.id !== chrome.runtime.id || sender.tab?.id !== run.tabId || run.state !== 'active' || run.transport !== 'direct' || typeof targetId !== 'string' || !/^\d+$/.test(targetId) || typeof accountHandle !== 'string' || run.account.handle.toLowerCase() !== accountHandle.toLowerCase()) {
        respond({ ok: false, missing: false }); return;
      }
      const missing = await verifyMissingPost(targetId, accountHandle).catch(() => false);
      respond({ ok: true, missing });
    })();
    return true;
  }
  if (message?.type === 'fetch-x-static-asset') {
    const asset = allowedXAssetUrl(message.url);
    const senderUrl = sender.tab?.url ?? sender.url ?? '';
    if (sender.id !== chrome.runtime.id || !/^https:\/\/(?:x|twitter)\.com\//.test(senderUrl) || !asset) {
      respond({ ok: false, error: 'Invalid X asset request.' }); return;
    }
    void (async () => {
      try {
        const response = await fetch(asset.href, { credentials: 'omit', redirect: 'error' });
        const advertised = Number(response.headers.get('content-length'));
        if (!response.ok) { respond({ ok: false, error: `X metadata request failed with HTTP ${response.status}.`, status: response.status }); return; }
        if (Number.isFinite(advertised) && advertised > MAX_X_ASSET_BYTES) { respond({ ok: false, error: 'X metadata response exceeded the safety limit.' }); return; }
        const text = await response.text();
        if (new TextEncoder().encode(text).length > MAX_X_ASSET_BYTES) { respond({ ok: false, error: 'X metadata response exceeded the safety limit.' }); return; }
        respond({ ok: true, text });
      } catch {
        respond({ ok: false, error: 'The public X metadata asset could not be fetched.' });
      }
    })();
    return true;
  }
  if (message?.type === 'notify-discovery') {
    if (!sender.url?.startsWith(chrome.runtime.getURL('dashboard.html')) || typeof message.count !== 'number') {
      respond({ ok: false }); return;
    }
    chrome.notifications.create('discovery-complete', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon.svg'),
      title: 'XSweep discovery complete',
      message: `${message.count} queue item${message.count === 1 ? '' : 's'} found. The X tab is available again.`,
      priority: 1
    }, () => respond({ ok: !chrome.runtime.lastError }));
    return true;
  }
  if (message?.type !== 'x-operation' || !sender.url?.startsWith(chrome.runtime.getURL('dashboard.html'))) return;
  void (async () => {
    const operation = message.operation as Record<string, unknown> | undefined;
    const tabId = message.tabId;
    if (!operation || typeof tabId !== 'number' || !['inspect', 'mutate'].includes(String(operation.type))) { respond({ ok: false, error: 'Invalid operation' }); return; }
    const run = await store.get<Run>('runs', String(operation.runId));
    if (!runAuthorizesOperation(run, tabId, operation)) { respond({ ok: false, error: 'Run is no longer authorized' }); return; }
    chrome.tabs.sendMessage(tabId, operation, response => {
      if (chrome.runtime.lastError) respond({ ok: false, error: 'Cleanup tab is unavailable' }); else respond(response);
    });
  })();
  return true;
});
