import { isMessage, type ContentResponse } from '../shared/messages';
import type { Account } from '../shared/contracts';
import { extractItems, signedInHandle, discoveryReadiness } from './discovery';
import { observeAction, mutateAction } from './actions';

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'discover-page') return;
  const handle = signedInHandle(document);
  const category = message.category;
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('dashboard.html')) || !['posts', 'replies', 'likes'].includes(category) || typeof message.handle !== 'string') {
    respond({ error: 'Invalid discovery request' }); return;
  }
  const readiness = discoveryReadiness(document, location.pathname, message.handle, category);
  if (readiness) { respond(readiness); return; }
  if (!handle) return;
  if (document.querySelector('[data-testid="error-detail"], iframe[src*="captcha"], input[autocomplete="one-time-code"]')) {
    respond({ error: 'Page unavailable or challenge detected' }); return;
  }
  respond({ items: extractItems(document, handle, category), articles: document.querySelectorAll('article[data-testid="tweet"]').length });
  // One scroll per dashboard request; no autonomous timers survive disconnect.
  const scroller = document.scrollingElement;
  if (scroller) scroller.scrollBy({ top: Math.max(400, window.innerHeight * 0.8), behavior: 'instant' });
});
function account(): Account|undefined { const handle = signedInHandle(document); return handle ? { id: handle.toLowerCase(), handle } : undefined; }
chrome.runtime.onMessage.addListener((raw, sender, respond) => { if (raw?.type === 'discover-page') return; if(sender.id!==chrome.runtime.id || !isMessage(raw)){respond({ok:false,error:'Invalid message'} satisfies ContentResponse);return;} if(raw.type==='get-account'){respond({ok:true,observation:{targetId:'account',state:'active',account:account()}} satisfies ContentResponse);return;} void (async()=>{try{const currentAccount=account();const observation=raw.type==='inspect'?observeAction(document,raw.targetId,raw.action,currentAccount):await mutateAction(document,raw.targetId,raw.action,currentAccount);respond({ok:true,observation} satisfies ContentResponse);}catch(error){respond({ok:false,error:error instanceof Error?error.message:'X page controls changed; no action was verified'} satisfies ContentResponse);}})(); return true; });
