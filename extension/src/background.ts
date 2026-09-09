import { store } from './storage/db';
chrome.action.onClicked.addListener(() => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') }));
chrome.runtime.onConnect.addListener(port => { if (port.name !== 'dashboard') return; port.onDisconnect.addListener(() => { void interrupt(); }); });
chrome.tabs.onRemoved.addListener(tabId => { void (async()=>{const r=await store.activeRun();if(r?.tabId===tabId){r.state='interrupted';await store.put('runs',r);}})(); });
async function interrupt(){const r=await store.activeRun();if(r?.state==='active'){r.state='interrupted';await store.put('runs',r);}}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'notify-discovery') {
    if (!sender.url?.startsWith(chrome.runtime.getURL('dashboard.html')) || typeof message.count !== 'number') {
      respond({ ok: false }); return;
    }
    chrome.notifications.create('discovery-complete', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon.svg'),
      title: 'Tweet Cleaner discovery complete',
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
    const run = await store.get<{ id:string; tabId:number; state:string; activeAttemptId?:string }>('runs', String(operation.runId));
    if (!run || run.state !== 'active' || run.tabId !== tabId || run.activeAttemptId !== operation.attemptId) { respond({ ok: false, error: 'Run is no longer authorized' }); return; }
    chrome.tabs.sendMessage(tabId, operation, response => {
      if (chrome.runtime.lastError) respond({ ok: false, error: 'Cleanup tab is unavailable' }); else respond(response);
    });
  })();
  return true;
});
