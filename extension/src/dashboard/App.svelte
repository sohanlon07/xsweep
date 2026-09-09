<script lang="ts">
  import { discover } from './discover';
  import { itemKind, matchesDateRange, sortItems, type SortKey } from './filter';
  import { openTarget } from './execution';
  let limits = { posts: 100, replies: 100, likes: 100 };
  let discovery: AbortController | undefined;
  let discoveryStatus = '';
  let dateStart = '';
  let dateEnd = '';
  let kindFilter: 'all' | 'tweet' | 'reply' | 'repost' | 'like' = 'all';
  let sortKey: SortKey = 'date';
  let sortDirection: 'asc' | 'desc' = 'desc';
  onMount(() => () => discovery?.abort());
  async function startDiscovery() {
    if (running || !account || tabId === undefined) return;
    const controller = new AbortController(); discovery = controller; running = true; error = '';
    try {
      await discover(tabId, account, limits, controller.signal, async (results, detail) => {
        const merged = new Map(items.map(item => [item.id, item]));
        results.forEach(item => {
          const existing = merged.get(item.id);
          // Refresh category metadata so queues created by older builds are
          // corrected without losing selection or execution state.
          merged.set(item.id, existing ? { ...existing, kind: item.kind } : item);
        });
        const next = [...merged.values()];
        await store.replaceItems(next);
        items = next; discoveryStatus = detail;
      });
      if (!controller.signal.aborted) {
        await chrome.runtime.sendMessage({ type: 'notify-discovery', count: items.length });
      }
    } catch (e) { error = e instanceof Error ? e.message : 'Discovery interrupted'; discoveryStatus = 'Stopped — partial results retained.'; }
    finally { discovery = undefined; running = false; }
  }
  import { onMount } from 'svelte'; import { store } from '../storage/db'; import type { Account, Attempt, QueueItem, Run } from '../shared/contracts'; import type { ContentResponse } from '../shared/messages';
  let items:QueueItem[]=[]; let account:Account|undefined; let tabId:number|undefined; let error=''; let running=false; let includeUnknown=false; let port:chrome.runtime.Port|undefined;
  onMount(()=>{if(!globalThis.chrome?.runtime?.id){error='Tweet Cleaner must be opened from an installed extension. Build the project and load extension/dist at chrome://extensions.';return;}port=chrome.runtime.connect({name:'dashboard'}); void (async()=>{items=await store.all<QueueItem>('items'); const active=await store.activeRun(); if(active){error='An interrupted run is available. Re-open its X tab and start a new reviewed batch.';}})(); return()=>port?.disconnect();});
  let xTabs: chrome.tabs.Tab[] = [];
  let connecting = false;
  async function connect() {
    if (running || connecting) return;
    error = ''; account = undefined; tabId = undefined; xTabs = [];
    connecting = true;
    try {
      xTabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
      if (!xTabs.length) error = 'No X tabs found in this browser. Open X in the browser where Tweet Cleaner is installed.';
      else if (xTabs.length === 1) await connectTab(xTabs[0]);
    } catch { error = 'Unable to list X tabs. Reload the extension and reopen this dashboard.'; }
    finally { connecting = false; }
  }
  async function connectTab(tab: chrome.tabs.Tab) {
    if (running || tab.id === undefined) return;
    error = ''; account = undefined; tabId = undefined;
    try {
      const current = await chrome.tabs.get(tab.id);
      if (!/^https:\/\/(x|twitter)\.com\//.test(current.url ?? '')) {
        error = 'That tab has navigated away from X. Find X tabs again.'; return;
      }
      const r = await chrome.tabs.sendMessage(tab.id, { type: 'get-account' }) as ContentResponse;
      if (!r?.ok || !r.observation?.account) {
        error = 'Could not identify the signed-in account in that X tab. Check that X has finished loading and you are signed in.'; return;
      }
      tabId = tab.id; account = r.observation.account; xTabs = [];
    } catch { error = 'Could not connect to that X tab. Refresh the X page after installing or reloading the extension, then try again.'; }
  }
  async function importArchive(e:Event){const file=(e.currentTarget as HTMLInputElement).files?.[0];if(!file)return;error='';const worker=new Worker(new URL('../archive/worker.ts',import.meta.url),{type:'module'});worker.onmessage=async({data})=>{worker.terminate();if(!data.ok){error=data.error;return;}items=data.items;await store.replaceItems(items);};worker.postMessage({file});}
  async function save(){await store.replaceItems(items);}
  $: previewItems = sortItems(items.filter(item => matchesDateRange(item, dateStart, dateEnd, includeUnknown) && (kindFilter === 'all' || itemKind(item) === kindFilter)), sortKey, sortDirection);
  $: previewCounts = previewItems.reduce((counts, item) => ({ ...counts, [itemKind(item)]: counts[itemKind(item)] + 1 }), { tweet: 0, reply: 0, repost: 0, like: 0 });
  $: selectablePreviewItems = previewItems.filter(item => !item.ambiguity);
  $: allVisibleSelected = selectablePreviewItems.length > 0 && selectablePreviewItems.every(item => item.selected);
  function eligible(){return previewItems.filter(i=>i.selected&&!i.ambiguity);}
  $: selectedCount = eligible().length;
  function toggleItem(item: QueueItem, selected: boolean) { item.selected = selected; items = [...items]; }
  async function selectVisible(selected: boolean) { previewItems.forEach(item => { if (!item.ambiguity) item.selected = selected; }); items = [...items]; await save(); }
  function changeSort(key: SortKey) { if (sortKey === key) sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'; else { sortKey = key; sortDirection = key === 'date' ? 'desc' : 'asc'; } }
  function sortMark(key: SortKey) { return sortKey === key ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : ''; }
  async function operate(operation: Record<string, unknown>): Promise<ContentResponse> { return chrome.runtime.sendMessage({type:'x-operation',tabId,operation}) as Promise<ContentResponse>; }
  async function execute(mode: 'preview' | 'live') {
    const executionDryRun = mode === 'preview';
    if (!account || tabId === undefined) { error = 'Connect an X tab first.'; return; }
    const selected = eligible();
    if (!selected.length) { error = 'Select dated, unambiguous items to continue.'; return; }
    if (!executionDryRun && !confirm(`Approve ${selected.length} irreversible actions for @${account.handle}?`)) return;
    error = '';
    const run: Run = { id: crypto.randomUUID(), revision: 1, tabId, account, itemIds: selected.map(item => item.id), dryRun: executionDryRun, state: 'active', nextEligibleAt: Date.now() };
    if (!await store.claim(run)) { error = 'Another dashboard owns an active run.'; return; }
    running = true;
    try {
      for (const item of selected) {
        if (run.state !== 'active') break;
        item.state = 'inspecting';
        await store.put('items', item);
        if (!await openTarget(tabId, item)) {
          item.state = 'needs_attention';
          await store.put('items', item);
          run.state = 'paused';
          await store.put('runs', run);
          error = `Could not open the exact target ${item.targetId}.`;
          break;
        }
        const attempt: Attempt = { id: crypto.randomUUID(), runId: run.id, itemId: item.id, state: 'started', createdAt: Date.now() };
        run.activeAttemptId = attempt.id;
        await store.put('runs', run);
        await store.put('attempts', attempt);
        const inspect = await operate({ type: 'inspect', runId: run.id, attemptId: attempt.id, itemId: item.id, action: item.action, targetId: item.targetId });
        if (!inspect.ok || inspect.observation.account?.id !== account.id) {
          const detail = inspect.ok ? 'The signed-in account changed before the target could be inspected.' : inspect.error;
          item.state = 'needs_attention'; attempt.state = 'uncertain'; attempt.detail = detail; run.state = 'paused'; error = detail;
          await store.put('attempts', attempt); await store.put('items', item);
          break;
        }
        if (inspect.observation.state === 'inactive') {
          item.state = 'already_done'; attempt.state = 'verified'; attempt.result = item.state;
          await store.put('attempts', attempt); await store.put('items', item);
          continue;
        }
        if (inspect.observation.state !== 'active') {
          const detail = inspect.observation.detail ?? `The exact target ${item.targetId} could not be safely identified.`;
          item.state = 'needs_attention'; attempt.state = 'uncertain'; attempt.detail = detail; run.state = 'paused'; error = detail;
          await store.put('attempts', attempt); await store.put('items', item);
          break;
        }
        if (executionDryRun) { item.state = 'skipped'; await store.put('items', item); continue; }
        item.state = 'executing';
        await store.put('items', item);
        const result = await operate({ type: 'mutate', runId: run.id, attemptId: attempt.id, itemId: item.id, action: item.action, targetId: item.targetId });
        if (!result.ok || result.observation.state !== 'inactive') {
          const detail = result.ok ? result.observation.detail ?? 'Post-action verification was inconclusive.' : result.error;
          item.state = 'needs_attention'; attempt.state = 'uncertain'; attempt.detail = detail; run.state = 'paused'; error = detail;
        } else {
          item.state = 'succeeded'; attempt.state = 'verified'; attempt.result = item.state;
        }
        await store.put('attempts', attempt); await store.put('items', item);
        run.nextEligibleAt = Date.now() + 20000;
        await store.put('runs', run);
        if (run.state === 'active') await new Promise(resolve => setTimeout(resolve, 20000));
      }
      if (run.state === 'active') run.state = 'complete';
      await store.put('runs', run);
      items = await store.all('items');
    } catch {
      run.state = 'interrupted';
      await store.put('runs', run);
      error = 'Execution was interrupted; no item will be replayed automatically.';
    } finally { running = false; }
  }
  function exportQueue(){const blob=new Blob([JSON.stringify(items,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='tweet-cleaner-queue.json';a.click();URL.revokeObjectURL(url);}
</script>
<section class="panel" aria-label="Browser discovery">
  <h2>Discover visible X history</h2>
  <p>Visits your profile, replies, and Likes in the connected tab. Results may be incomplete. New items are unselected; like and repost dates are unknown. Set a category to 0 to skip it.</p>
  {#if discovery}<p class="discovery-warning">Discovery is controlling the connected X tab. Leave that tab open until the completion notification appears.</p>{/if}
  <label>Posts limit <input type="number" min="0" max="1000" bind:value={limits.posts} disabled={running}/></label>
  <label>Replies limit <input type="number" min="0" max="1000" bind:value={limits.replies} disabled={running}/></label>
  <label>Likes limit <input type="number" min="0" max="1000" bind:value={limits.likes} disabled={running}/></label>
  <button class="btn" disabled={running || !account} on:click={startDiscovery}>Discover history</button>
  {#if discovery}<button class="btn" on:click={() => discovery?.abort()}>Cancel discovery</button>{/if}
  <p role="status" aria-live="polite">{discoveryStatus}</p>
</section>
{#if xTabs.length > 1}
  <section class="panel" aria-label="Choose an X tab">
    <h2>Choose an X tab to connect</h2>
    {#each xTabs as tab}
      <button class="btn" disabled={running} on:click={() => connectTab(tab)}>{tab.title ?? 'X'} — {tab.url} (tab {tab.id})</button>
    {/each}
  </section>
{/if}
<main>
  <header><h1>Tweet Cleaner</h1><p class="muted">Local, review-first X cleanup. The extension never reads cookies or uses an API token.</p></header>
  <section class="panel"><button class="btn" on:click={connect}>Connect current X tab</button>{#if account}<span> Connected as <b>@{account.handle}</b></span>{/if}<p class="muted">Keep this dashboard and the dedicated X tab open while executing.</p></section>
  <section class="panel"><h2>Import archive</h2><input type="file" accept=".zip,application/zip" on:change={importArchive}/><button class="btn" on:click={save}>Save review queue</button><button class="btn" on:click={exportQueue}>Export</button></section>
  {#if error}<p class="panel" style="color:#fecaca">{error}</p>{/if}
  <section class="panel">
    <h2>Review queue ({previewItems.length} of {items.length})</h2>
    <div class="filters">
      <label>From <input type="date" bind:value={dateStart}/></label>
      <label>To <input type="date" bind:value={dateEnd}/></label>
      <label>Category <select bind:value={kindFilter}><option value="all">All</option><option value="tweet">Tweets</option><option value="reply">Replies</option><option value="repost">Reposts</option><option value="like">Likes</option></select></label>
      {#if dateStart || dateEnd}<label><input type="checkbox" bind:checked={includeUnknown}/> include unknown action dates</label>{/if}
    </div>
    <p class="counts"><span>Tweet {previewCounts.tweet}</span><span>Reply {previewCounts.reply}</span><span>Repost {previewCounts.repost}</span><span>Like {previewCounts.like}</span></p>
    <div class="queue-actions"><button class="btn" disabled={running || !previewItems.length} on:click={() => selectVisible(true)}>Select all visible</button><button class="btn" disabled={running || !previewItems.length} on:click={() => selectVisible(false)}>Clear visible selection</button><strong>{selectedCount} selected for action</strong></div>
    <div class="execution-actions"><button class="btn" disabled={running} on:click={() => execute('preview')}>{running?'Running…':'Preview selected (read only)'}</button><button class="btn danger" disabled={running} on:click={() => execute('live')}>Execute selected actions</button></div>
    <table><thead><tr><th><input type="checkbox" aria-label="Select all visible rows" checked={allVisibleSelected} on:change={(event) => selectVisible(event.currentTarget.checked)} disabled={running || !selectablePreviewItems.length}/></th><th aria-sort={sortKey === 'kind' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}><button class="sort" on:click={() => changeSort('kind')}>Category{sortMark('kind')}</button></th><th aria-sort={sortKey === 'action' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}><button class="sort" on:click={() => changeSort('action')}>Action{sortMark('action')}</button></th><th aria-sort={sortKey === 'text' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}><button class="sort" on:click={() => changeSort('text')}>Text{sortMark('text')}</button></th><th aria-sort={sortKey === 'date' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}><button class="sort" on:click={() => changeSort('date')}>Date{sortMark('date')}</button></th><th aria-sort={sortKey === 'state' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}><button class="sort" on:click={() => changeSort('state')}>State{sortMark('state')}</button></th></tr></thead><tbody>{#each previewItems as item}<tr><td><input type="checkbox" aria-label={`Select ${item.targetId}`} checked={item.selected} on:change={(event) => toggleItem(item, event.currentTarget.checked)} disabled={!!item.ambiguity}/></td><td><span class="kind kind-{itemKind(item)}">{itemKind(item)}</span></td><td>{item.action}</td><td>{item.text}</td><td>{item.occurredAt ?? 'Unknown'}</td><td>{item.state}</td></tr>{/each}</tbody></table>
  </section>
</main>
<style>main{max-width:1100px;margin:auto;padding:28px}header{margin-bottom:24px}section{margin:16px 0}button,label{margin:8px}h1,h2{color:white}.discovery-warning{padding:10px;border:1px solid #f59e0b;border-radius:8px;background:#78350f;color:#fef3c7;font-weight:600}.filters,.queue-actions,.execution-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.execution-actions{margin-top:16px}.counts{display:flex;gap:8px}.counts span,.kind{padding:3px 8px;border-radius:999px;background:#334155;text-transform:capitalize;font-size:12px}.kind-tweet{background:#075985}.kind-reply{background:#5b21b6}.kind-repost{background:#047857}.kind-like{background:#9f1239}.sort{background:transparent;color:#e2e8f0;border:0;padding:4px;margin:0;font-weight:700}.sort:hover{color:white;text-decoration:underline}</style>
