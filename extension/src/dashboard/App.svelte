<script lang="ts">
  import { discover, type DiscoveryRange } from './discover';
  import type { Category } from '../content/discovery';
  import { itemKind, sortItems, type SortKey } from './filter';
  import { abortableDelay, adaptiveDelay } from './execution';
  let discoveryScope: 'all' | 'day' | 'week' | 'month' | 'custom' = 'month';
  let discoveryStart = '';
  let discoveryEnd = '';
  let discoveryCategories: Record<Category, boolean> = { posts: true, replies: true, likes: true };
  let discovery: AbortController | undefined;
  let discoveryStatus = '';
  let discoveryError = '';
  let kindFilter: 'all' | 'tweet' | 'reply' | 'repost' | 'like' = 'all';
  let sortKey: SortKey = 'date';
  let sortDirection: 'asc' | 'desc' = 'desc';
  function dateOffset(days: number): string { const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - days); return date.toISOString().slice(0, 10); }
  function selectedDiscoveryRange(): DiscoveryRange {
    if (discoveryScope === 'all') return {};
    if (discoveryScope === 'custom') return { start: discoveryStart || undefined, end: discoveryEnd || undefined };
    return { start: dateOffset(discoveryScope === 'day' ? 1 : discoveryScope === 'week' ? 7 : 30), end: dateOffset(0) };
  }
  function selectedDiscoveryCategories(): Category[] { return (Object.keys(discoveryCategories) as Category[]).filter(category => discoveryCategories[category]); }
  onMount(() => () => discovery?.abort());
  async function startDiscovery() {
    if (running || !account || tabId === undefined) return;
    const controller = new AbortController(); discovery = controller; running = true; batchProgress = undefined; discoveryError = '';
    try {
      await discover(tabId, account, selectedDiscoveryCategories(), selectedDiscoveryRange(), controller.signal, async (results, detail) => {
        // A discovery selection defines the queue. Do not retain unrelated
        // cached categories from an earlier discovery run.
        await store.replaceItems(results);
        items = results; discoveryStatus = detail;
      });
      if (!controller.signal.aborted) {
        await chrome.runtime.sendMessage({ type: 'notify-discovery', count: items.length });
      }
    } catch (e) { discoveryError = e instanceof Error ? e.message : 'Discovery interrupted'; discoveryStatus = 'Stopped — partial results retained.'; }
    finally { discovery = undefined; running = false; }
  }
  import { onMount } from 'svelte'; import { store } from '../storage/db'; import type { Account, Attempt, CapabilityState, QueueItem, Run } from '../shared/contracts'; import type { OperationResponse, ProbeResponse } from '../shared/messages';
  let items:QueueItem[]=[]; let attempts:Attempt[]=[]; let account:Account|undefined; let tabId:number|undefined; let connectionError=''; let importError=''; let executionError=''; let running=false; let port:chrome.runtime.Port|undefined;
  const transport = 'direct' as const;
  let capability: CapabilityState | undefined;
  let currentRun: Run | undefined;
  let executionAbort: AbortController | undefined;
  let rateStatus = '';
  type QueueKind = 'tweet' | 'reply' | 'repost' | 'like';
  type ProgressBucket = { total: number; complete: number; attention: number };
  type BatchProgress = { mode: 'preview' | 'live'; completed: number; total: number; current?: QueueItem; buckets: Record<QueueKind, ProgressBucket> };
  const queueKinds: QueueKind[] = ['tweet', 'reply', 'repost', 'like'];
  let batchProgress: BatchProgress | undefined;
  function makeBatchProgress(selected: QueueItem[], mode: 'preview' | 'live'): BatchProgress {
    const buckets = { tweet: { total: 0, complete: 0, attention: 0 }, reply: { total: 0, complete: 0, attention: 0 }, repost: { total: 0, complete: 0, attention: 0 }, like: { total: 0, complete: 0, attention: 0 } };
    selected.forEach(item => buckets[itemKind(item)].total += 1);
    return { mode, completed: 0, total: selected.length, buckets };
  }
  function recordProgress(item: QueueItem, attention = false) {
    if (!batchProgress) return;
    const kind = itemKind(item);
    batchProgress.buckets[kind].complete += 1;
    if (attention) batchProgress.buckets[kind].attention += 1;
    batchProgress = { ...batchProgress, completed: batchProgress.completed + 1, current: item, buckets: { ...batchProgress.buckets } };
  }
  onMount(()=>{if(!globalThis.chrome?.runtime?.id){connectionError='XSweep must be opened from an installed extension. Build the project and load extension/dist at chrome://extensions.';return;}port=chrome.runtime.connect({name:'dashboard'}); void (async()=>{const [storedItems, storedAttempts, runs] = await Promise.all([store.all<QueueItem>('items'), store.all<Attempt>('attempts'), store.all<Run>('runs')]); items=storedItems; attempts=storedAttempts; const active=runs.find(run => ['active','paused','interrupted'].includes(run.state)); if(active){executionError=active.dryRun ? 'A previous discovery stopped early. Partial results were retained; you can run discovery again when X is ready.' : 'A previous cleanup run stopped before completion. It will not resume automatically; review the remaining items and start a new batch.';} await connect();})().catch(() => { connectionError = 'Could not check the active X tab. Try reopening this side panel.'; }); return()=>port?.disconnect();});
  let xTabs: chrome.tabs.Tab[] = [];
  let connecting = false;
  async function connect() {
    if (running || connecting) return;
    connectionError = ''; account = undefined; tabId = undefined; xTabs = [];
    connecting = true;
    try {
      const active = await chrome.tabs.query({ active: true, currentWindow: true, url: ['https://x.com/*', 'https://twitter.com/*'] });
      if (active.length === 1) { await connectTab(active[0]); return; }
      xTabs = await chrome.tabs.query({ url: ['https://x.com/*', 'https://twitter.com/*'] });
      if (!xTabs.length) connectionError = 'No X tabs found in this browser. Open X in the browser where XSweep is installed.';
      else if (xTabs.length === 1) await connectTab(xTabs[0]);
    } catch { connectionError = 'Unable to list X tabs. Reload the extension and reopen this dashboard.'; }
    finally { connecting = false; }
  }
  async function connectTab(tab: chrome.tabs.Tab) {
    if (running || tab.id === undefined) return;
    connectionError = ''; account = undefined; tabId = undefined;
    try {
      const current = await chrome.tabs.get(tab.id);
      if (!/^https:\/\/(x|twitter)\.com\//.test(current.url ?? '')) {
        connectionError = 'That tab has navigated away from X. Find X tabs again.'; return;
      }
      const r = await chrome.tabs.sendMessage(tab.id, { type: 'get-account' }) as OperationResponse;
      if (!r?.ok || !r.observation?.account) {
        connectionError = 'Could not identify the signed-in account in that X tab. Check that X has finished loading and you are signed in.'; return;
      }
      tabId = tab.id; account = r.observation.account; xTabs = [];
      await probeTransport();
    } catch { connectionError = 'Could not connect to that X tab. Refresh the X page after installing or reloading the extension, then try again.'; }
  }
  async function probeTransport() {
    if (tabId === undefined) return false;
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: 'probe', transport }) as ProbeResponse;
      if (!response.ok) { capability = { state: 'unavailable', detail: response.error, checkedAt: Date.now() }; return false; }
      capability = response.capability;
      if ('account' in response && response.account) account = response.account;
      return capability.state === 'ready';
    } catch { capability = { state: 'unavailable', detail: 'Refresh the connected X tab and retry the capability check.', checkedAt: Date.now() }; return false; }
  }
  async function importArchive(e:Event){const file=(e.currentTarget as HTMLInputElement).files?.[0];if(!file)return;importError='';const worker=new Worker(new URL('../archive/worker.ts',import.meta.url),{type:'module'});worker.onmessage=async({data})=>{worker.terminate();if(!data.ok){importError=data.error;return;}items=data.items;await store.replaceItems(items);};worker.postMessage({file});}
  async function startFresh() { if (running) return; await store.clearHistory(); items = []; attempts = []; discoveryStatus = ''; discoveryError = ''; executionError = ''; rateStatus = ''; }
  async function save(){await store.replaceItems(items);}
  // Verified mutations leave the durable queue record intact, but no longer
  // belong in review. Reconciliation can still inspect the stored outcome.
  $: previewItems = sortItems(items.filter(item => item.state !== 'succeeded' && item.state !== 'already_done' && (kindFilter === 'all' || itemKind(item) === kindFilter)), sortKey, sortDirection);
  $: previewCounts = previewItems.reduce((counts, item) => ({ ...counts, [itemKind(item)]: counts[itemKind(item)] + 1 }), { tweet: 0, reply: 0, repost: 0, like: 0 });
  $: selectablePreviewItems = previewItems.filter(item => !item.ambiguity);
  $: allVisibleSelected = selectablePreviewItems.length > 0 && selectablePreviewItems.every(item => item.selected);
  $: selectedItems = selectablePreviewItems.filter(item => item.selected);
  $: selectedCount = selectedItems.length;
  $: latestAttempts = attempts.reduce((latest, attempt) => (!latest[attempt.itemId] || latest[attempt.itemId].createdAt < attempt.createdAt ? { ...latest, [attempt.itemId]: attempt } : latest), {} as Record<string, Attempt>);
  function attentionAction(item: QueueItem): string {
    const attempt = latestAttempts[item.id];
    switch (attempt?.failureCategory) {
      case 'authentication': case 'challenge': return 'Refresh X, sign in or complete the challenge, then select and retry this item.';
      case 'account': return 'Reconnect the intended X account, then select and retry this item.';
      case 'rate_limit': return 'Wait for X’s reset time, then select and retry this item.';
      case 'network_after_dispatch': case 'verification': return 'Do not retry automatically. Check X, then run discovery again to reconcile the result.';
      case 'network_before_dispatch': case 'metadata': case 'response': return 'Refresh the X tab, then select and retry this item.';
      default: return 'Review the target on X, then run discovery again before retrying.';
    }
  }
  function eligible(){return selectedItems;}
  function toggleItem(item: QueueItem, selected: boolean) { item.selected = selected; items = [...items]; void save(); }
  async function selectVisible(selected: boolean) { previewItems.forEach(item => { if (!item.ambiguity) item.selected = selected; }); items = [...items]; await save(); }
  function changeSort(key: SortKey) { if (sortKey === key) sortDirection = sortDirection === 'asc' ? 'desc' : 'asc'; else { sortKey = key; sortDirection = key === 'date' ? 'desc' : 'asc'; } }
  function sortMark(key: SortKey) { return sortKey === key ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : ''; }
  async function operate(operation: Record<string, unknown>): Promise<OperationResponse> { return chrome.runtime.sendMessage({type:'x-operation',tabId,operation}) as Promise<OperationResponse>; }
  async function execute(mode: 'preview' | 'live') {
    const executionDryRun = mode === 'preview';
    if (!account || tabId === undefined) { executionError = 'Connect an X tab first.'; return; }
    if (!await probeTransport()) { executionError = capability?.detail ?? `${transport} transport is unavailable.`; return; }
    const selected = eligible();
    if (!selected.length) { executionError = 'Select one or more unambiguous items to continue.'; return; }
    executionError = '';
    const run: Run = { id: crypto.randomUUID(), revision: 1, tabId, account, itemIds: selected.map(item => item.id), dryRun: executionDryRun, state: 'active', nextEligibleAt: Date.now(), transport, capability };
    if (!await store.claim(run)) { executionError = 'Another dashboard owns an active run.'; return; }
    running = true; currentRun = run; executionAbort = new AbortController(); batchProgress = makeBatchProgress(selected, mode);
    try {
      for (const item of selected) {
        if (run.state !== 'active') break;
        item.state = 'inspecting';
        await store.put('items', item);
        const attempt: Attempt = { id: crypto.randomUUID(), runId: run.id, itemId: item.id, state: 'started', createdAt: Date.now() };
        run.activeAttemptId = attempt.id;
        await store.put('runs', run);
        await store.put('attempts', attempt);
        const inspect = await operate({ type: 'inspect', runId: run.id, attemptId: attempt.id, itemId: item.id, action: item.action, targetId: item.targetId, accountId: account.id, accountHandle: account.handle, transport });
        if (!inspect.ok || inspect.observation.account?.id !== account.id) {
          const detail = inspect.ok ? 'The signed-in account changed before the target could be inspected.' : inspect.error;
          item.state = 'needs_attention'; attempt.state = 'failed'; attempt.detail = `Before dispatch: ${detail}`; attempt.failureCategory = inspect.ok ? 'account' : inspect.category as Attempt['failureCategory']; attempt.verification = 'not_started'; run.state = 'paused'; executionError = attempt.detail;
          await store.put('attempts', attempt); await store.put('items', item);
          recordProgress(item, true);
          break;
        }
        run.metadataRevision = inspect.metadataRevision; run.rateLimit = inspect.rateLimit; rateStatus = describeRate(inspect.rateLimit); await store.put('runs', run);
        if (inspect.observation.state === 'inactive') {
          item.state = 'already_done'; attempt.state = 'verified'; attempt.result = item.state; attempt.verification = 'confirmed';
          await store.put('attempts', attempt); await store.put('items', item);
          items = [...items];
          recordProgress(item);
          continue;
        }
        if (inspect.observation.state !== 'active') {
          const detail = inspect.observation.detail ?? `The exact target ${item.targetId} could not be safely identified.`;
          item.state = 'needs_attention'; attempt.state = 'failed'; attempt.detail = `Before dispatch: ${detail}`; attempt.failureCategory = 'verification'; attempt.verification = 'not_started'; run.state = 'paused'; executionError = attempt.detail;
          await store.put('attempts', attempt); await store.put('items', item);
          recordProgress(item, true);
          break;
        }
        if (executionDryRun) { item.state = 'skipped'; attempt.state = 'verified'; attempt.result = item.state; attempt.verification = 'confirmed'; await store.put('attempts', attempt); await store.put('items', item); recordProgress(item); continue; }
        if (transport === 'direct') {
          const wait = adaptiveDelay(run.rateLimit);
          run.nextEligibleAt = Date.now() + wait;
          await store.put('runs', run);
          if (!await abortableDelay(wait, executionAbort.signal)) { run.state = 'cancelled'; attempt.state = 'failed'; attempt.failureCategory = 'cancelled'; attempt.detail = 'Cancelled before dispatch.'; await store.put('attempts', attempt); break; }
        }
        item.state = 'executing';
        await store.put('items', item);
        attempt.state = 'dispatched'; attempt.dispatchedAt = Date.now(); attempt.operation = item.action === 'delete_post' ? 'DeleteTweet' : item.action === 'undo_repost' ? 'DeleteRetweet' : 'UnfavoriteTweet'; attempt.verification = 'not_started';
        await store.put('attempts', attempt);
        const result = await operate({ type: 'mutate', runId: run.id, attemptId: attempt.id, itemId: item.id, action: item.action, targetId: item.targetId, accountId: account.id, accountHandle: account.handle, transport });
        if (!result.ok || result.observation.state !== 'inactive') {
          const detail = result.ok ? result.observation.detail ?? 'Post-action verification was inconclusive.' : result.error;
          const dispatched = result.ok || result.dispatched !== false;
          item.state = 'needs_attention'; attempt.state = dispatched ? 'uncertain' : 'failed'; attempt.detail = `${dispatched ? 'After dispatch, outcome uncertain' : 'Before dispatch'}: ${detail}`; attempt.failureCategory = result.ok ? 'verification' : result.category as Attempt['failureCategory']; attempt.httpStatus = result.httpStatus; attempt.verification = dispatched ? 'inconclusive' : 'not_started'; if (!result.ok && result.rateLimit) { run.rateLimit = result.rateLimit; run.nextEligibleAt = result.rateLimit.resetAt ?? Date.now(); rateStatus = describeRate(result.rateLimit); } if (run.state === 'active') run.state = 'paused'; executionError = attempt.detail;
        } else {
          item.state = 'succeeded'; attempt.state = 'verified'; attempt.result = item.state; attempt.httpStatus = result.httpStatus; attempt.verification = 'confirmed'; run.metadataRevision = result.metadataRevision; run.rateLimit = result.rateLimit; rateStatus = describeRate(result.rateLimit);
        }
        await store.put('attempts', attempt); await store.put('items', item);
        // Item state mutates in place during a run. Reassign to refresh the
        // Svelte review list immediately after a verified deletion.
        items = [...items];
        recordProgress(item, item.state === 'needs_attention');
        run.nextEligibleAt = Date.now();
        await store.put('runs', run);
      }
      if (run.state === 'active') run.state = 'complete';
      await store.put('runs', run);
      [items, attempts] = await Promise.all([store.all<QueueItem>('items'), store.all<Attempt>('attempts')]);
    } catch {
      run.state = 'interrupted';
      await store.put('runs', run);
      executionError = 'Execution was interrupted; no item will be replayed automatically.';
    } finally { running = false; currentRun = undefined; executionAbort = undefined; batchProgress = undefined; }
  }
  async function cancelExecution() {
    if (!currentRun || tabId === undefined) return;
    currentRun.state = 'cancelled';
    await store.put('runs', currentRun);
    executionAbort?.abort();
    try { await chrome.tabs.sendMessage(tabId, { type: 'cancel', runId: currentRun.id, attemptId: currentRun.activeAttemptId }); } catch { /* Stored cancellation still prevents another action. */ }
  }
  function describeRate(rate?: Run['rateLimit']) {
    if (!rate) return '';
    if (rate.remaining !== undefined && rate.limit !== undefined) return `X request allowance: ${rate.remaining}/${rate.limit}${rate.resetAt ? `; resets ${new Date(rate.resetAt).toLocaleTimeString()}` : ''}.`;
    return rate.resetAt ? `X request allowance resets ${new Date(rate.resetAt).toLocaleTimeString()}.` : '';
  }
  function exportQueue(){const blob=new Blob([JSON.stringify(items,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='xsweep-queue.json';a.click();URL.revokeObjectURL(url);}
 </script>
{#if xTabs.length > 1}
  <section class="panel" aria-label="Choose an X tab">
    <h2>Choose an X tab to connect</h2>
    {#each xTabs as tab}
      <button class="btn" disabled={running} on:click={() => connectTab(tab)}>{tab.title ?? 'X'} — {tab.url} (tab {tab.id})</button>
    {/each}
  </section>
{/if}
<main>
  <header><h1>XSweep <button class="info-tip" type="button" data-tooltip="Review-first cleanup for your own X posts, replies, reposts, and likes. Discovery and actions use the active signed-in X tab." aria-label="About XSweep">?</button></h1><p class="muted">Local, review-first X cleanup. Direct requests use the signed-in X web session but never retrieve or store auth_token.</p></header>
  <section class="panel connection"><div class="section-heading"><div><p class="eyebrow">Step 1</p><h2>X session <button class="info-tip" type="button" data-tooltip="The active X tab connects automatically. Capability means the extension has observed the current X web client, session, CSRF state, and private operation metadata needed for safe requests." aria-label="About X session capability">?</button></h2></div>{#if account}<span class="connected">Connected as <b>@{account.handle}</b></span>{/if}</div>{#if connecting}<p class="muted">Connecting to the active X tab…</p>{/if}{#if connectionError}<p class="section-error" role="alert">{connectionError}</p><button class="btn secondary" disabled={connecting || running} on:click={connect}>Try again</button>{/if}{#if capability}<p class:transport-ready={capability.state === 'ready'} class:transport-unavailable={capability.state === 'unavailable'}>{capability.detail}</p>{/if}<p class="muted">The active X tab connects automatically. Direct X requests are used for discovery and cleanup; the X page is not navigated.</p></section>
  <section class="panel" aria-label="Browser discovery">
    <div class="section-heading"><div><p class="eyebrow">Step 2</p><h2>Discover X history <button class="info-tip" type="button" data-tooltip="Discovery controls what enters the queue. Dates use post creation dates. Posts and replies are filtered strictly; Likes and reposts uses both X timelines." aria-label="About discovery">?</button></h2></div></div>
    <p>Reads cursor-paginated history without navigating the connected tab. Discovery uses each post’s creation date; like and repost action dates remain unknown during review.</p>
    <div class="discovery-options"><label>Time period <select bind:value={discoveryScope} disabled={running}><option value="all">All history</option><option value="day">Last 24 hours</option><option value="week">Last 7 days</option><option value="month">Last 30 days</option><option value="custom">Custom dates</option></select></label>{#if discoveryScope === 'custom'}<label>From <input type="date" bind:value={discoveryStart} disabled={running}/></label><label>To <input type="date" bind:value={discoveryEnd} disabled={running}/></label>{/if}</div>
    <div class="category-options"><span>Include</span><label><input type="checkbox" bind:checked={discoveryCategories.posts} disabled={running}/> Posts</label><label><input type="checkbox" bind:checked={discoveryCategories.replies} disabled={running}/> Replies</label><label><input type="checkbox" bind:checked={discoveryCategories.likes} disabled={running}/> Likes and reposts</label></div>
    {#if discovery}<p class="discovery-warning">Discovery is controlling the connected X tab. Leave it open until it finishes or is cancelled.</p>{/if}
    <button class="btn" title="Replace the queue with only the selected categories and date range" disabled={running || !account || !selectedDiscoveryCategories().length} on:click={startDiscovery}>Discover selected history</button>
    {#if discovery}<button class="btn" title="Stop after the current read-only request; partial results remain available" on:click={() => discovery?.abort()}>Cancel discovery</button>{/if}
    <p role="status" aria-live="polite">{discoveryStatus}</p>
    {#if discoveryError}<p class="section-error" role="alert">{discoveryError}</p>{/if}
  </section>
  <section class="panel"><div class="section-heading"><div><p class="eyebrow">Optional</p><h2>Import archive <button class="info-tip" type="button" data-tooltip="An X archive is the most complete historical source and is processed locally. Importing replaces the current queue." aria-label="About archive import">?</button></h2></div></div><input type="file" accept=".zip,application/zip" on:change={importArchive}/><button class="btn secondary" title="Download the current local queue as JSON" on:click={exportQueue}>Export queue</button><p class="muted">Selections save automatically. Importing an archive replaces the current queue.</p>{#if importError}<p class="section-error" role="alert">{importError}</p>{/if}</section>
  <section class="panel">
    <div class="section-heading"><div><p class="eyebrow">Step 3</p><h2>Review queue ({previewItems.length} of {items.length}) <button class="info-tip" type="button" data-tooltip="Only selected, unambiguous rows can run. Preview is read-only; live actions are sequential, account-bound, and verified against the exact target." aria-label="About the review queue">?</button></h2></div><span class="queue-total">{selectedCount} selected</span></div>
    <div class="filters"><label>Category <select bind:value={kindFilter}><option value="all">All</option><option value="tweet">Tweets</option><option value="reply">Replies</option><option value="repost">Reposts</option><option value="like">Likes</option></select></label><button class="info-tip" type="button" data-tooltip="This filter changes what is visible and what Select all visible can select; it does not rediscover X." aria-label="About queue filtering">?</button></div>
    <p class="counts"><span>Tweet {previewCounts.tweet}</span><span>Reply {previewCounts.reply}</span><span>Repost {previewCounts.repost}</span><span>Like {previewCounts.like}</span></p>
    <div class="queue-actions"><button class="btn" title="Select every currently visible, unambiguous row" disabled={running || !previewItems.length} on:click={() => selectVisible(true)}>Select all visible</button><button class="btn" title="Clear selection on every currently visible row" disabled={running || !previewItems.length} on:click={() => selectVisible(false)}>Clear visible selection</button><button class="btn secondary" title="Clear local queue, run, and attempt history; this never changes X" disabled={running || !items.length} on:click={startFresh}>Start fresh</button><strong>{selectedCount} selected for action</strong></div><p class="muted">Start fresh clears saved queue and run history on this device; it never changes anything on X.</p>
    <div class="execution-actions"><button class="btn secondary" title="Read-only inspection; no X mutation is sent" disabled={running || !selectedCount} on:click={() => execute('preview')}>{running ? 'Running…' : `Preview ${selectedCount} selected`}</button><button class="btn danger" title="Run the exact selected actions now, sequentially and with readback verification" disabled={running || !selectedCount} on:click={() => execute('live')}>{running ? 'Running…' : `Run ${selectedCount} selected actions`}</button>{#if currentRun}<button class="btn" title="Stop before the next mutation; a request already dispatched may be uncertain" on:click={cancelExecution}>Cancel safely</button>{/if}</div><p class="muted">Live actions begin immediately for the selected, reviewed items. Each target is still inspected and account-bound before dispatch.</p>{#if executionError}<p class="section-error" role="alert">{executionError}</p>{/if}{#if rateStatus}<p class="muted" role="status">{rateStatus}</p>{/if}
    <table class="queue-table"><thead><tr><th><input type="checkbox" aria-label="Select all visible rows" checked={allVisibleSelected} on:change={(event) => selectVisible(event.currentTarget.checked)} disabled={running || !selectablePreviewItems.length}/></th><th aria-sort={sortKey === 'kind' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}><button class="sort" on:click={() => changeSort('kind')}>Category{sortMark('kind')}</button></th><th aria-sort={sortKey === 'action' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}><button class="sort" on:click={() => changeSort('action')}>Action{sortMark('action')}</button></th><th aria-sort={sortKey === 'text' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}><button class="sort" on:click={() => changeSort('text')}>Text{sortMark('text')}</button></th><th aria-sort={sortKey === 'date' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}><button class="sort" on:click={() => changeSort('date')}>Date{sortMark('date')}</button></th><th aria-sort={sortKey === 'state' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}><button class="sort" on:click={() => changeSort('state')}>State{sortMark('state')}</button></th></tr></thead><tbody>{#each previewItems as item}<tr><td class="selection-cell"><input type="checkbox" aria-label={`Select ${item.targetId}`} checked={item.selected} on:change={(event) => toggleItem(item, event.currentTarget.checked)} disabled={!!item.ambiguity}/></td><td data-label="Category"><span class="kind kind-{itemKind(item)}">{itemKind(item)}</span></td><td data-label="Action">{item.action}</td><td class="item-text" data-label="Text">{item.text}</td><td data-label="Date">{item.occurredAt ?? 'Unknown'}</td><td data-label="State" class:attention-state={item.state === 'needs_attention'}><span>{item.state === 'needs_attention' ? 'Needs attention' : item.state}</span>{#if item.state === 'needs_attention'}<p class="attention-detail">{latestAttempts[item.id]?.detail ?? 'The target could not be safely completed.'}</p><p class="attention-action">Next: {attentionAction(item)}</p>{/if}</td></tr>{/each}</tbody></table>
  </section>
</main>
{#if running && batchProgress}
  <aside class="run-overlay" aria-live="assertive" aria-label="Action progress">
    <div class="run-overlay-top"><div><p class="eyebrow">{batchProgress.mode === 'live' ? 'Live cleanup in progress' : 'Preview in progress'}</p><h2>{batchProgress.completed} of {batchProgress.total} checked</h2></div><button class="btn secondary" on:click={cancelExecution}>Cancel safely</button></div>
    <div class="progress-track" aria-hidden="true"><span style:width={`${Math.round((batchProgress.completed / batchProgress.total) * 100)}%`}></span></div>
    <div class="progress-grid">{#each queueKinds as kind}<div class="progress-kind"><span>{kind}</span><strong>{batchProgress.buckets[kind].complete}/{batchProgress.buckets[kind].total}</strong>{#if batchProgress.buckets[kind].attention}<small>{batchProgress.buckets[kind].attention} needs attention</small>{/if}</div>{/each}</div>
    {#if batchProgress.current}<p class="muted current-target">Current: {batchProgress.current.text || batchProgress.current.targetId}</p>{/if}
  </aside>
{/if}
<style>
  :global(body){margin:0;background:#081222;color:#dbe7fb;font-family:Inter,ui-sans-serif,system-ui,sans-serif;font-size:14px}
  main{max-width:1100px;margin:auto;padding:24px}
  header{margin:4px 0 22px} header h1{margin:0;color:#fff;font-size:28px;letter-spacing:-.04em} h2{margin:2px 0 8px;color:#f8fbff;font-size:18px;letter-spacing:-.02em}
  section{margin:14px 0}.panel{box-sizing:border-box;padding:18px;border:1px solid #263754;border-radius:16px;background:linear-gradient(145deg,#101d32,#0d182b);box-shadow:0 8px 28px #0002}
  button,label{margin:5px}.btn{border:1px solid #385273;border-radius:9px;padding:9px 12px;background:#1b304d;color:#edf5ff;font:inherit;font-weight:650;cursor:pointer}.btn:hover:not(:disabled){background:#27446a}.btn:disabled{opacity:.48;cursor:not-allowed}.primary{background:#0b8dcb;border-color:#19a6e5}.primary:hover:not(:disabled){background:#0aa4e9}.secondary{background:#172941}.danger{background:#9a2630;border-color:#ca3a48}.danger:hover:not(:disabled){background:#bd303d}.info-tip{position:relative;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin:0 0 0 4px;padding:0;border:1px solid #5c83ae;border-radius:50%;background:#142942;color:#9bd9ff;font-size:12px;font-weight:800;line-height:1;vertical-align:middle;cursor:help}.info-tip:hover,.info-tip:focus-visible{border-color:#7ed7ff;background:#1c4164;color:#fff;outline:2px solid #2d78a866;outline-offset:2px}.info-tip::after{content:attr(data-tooltip);position:absolute;z-index:50;top:calc(100% + 9px);left:0;width:max-content;max-width:min(300px,calc(100vw - 36px));padding:9px 11px;border:1px solid #426487;border-radius:8px;background:#071426;color:#e8f3ff;box-shadow:0 8px 24px #0009;font-size:12px;font-weight:500;line-height:1.4;text-align:left;white-space:normal;pointer-events:none;opacity:0;transform:translateY(-3px);transition:opacity .12s ease,transform .12s ease}.info-tip:hover::after,.info-tip:focus-visible::after{opacity:1;transform:translateY(0)}
  select,input{border:1px solid #3a4e6d;border-radius:8px;background:#0b172a;color:#edf5ff;padding:8px;font:inherit}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.eyebrow{margin:0;color:#68c8ff;font-size:11px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}.connected,.queue-total{padding:7px 10px;border-radius:999px;background:#123c38;color:#a7f3d0;font-size:13px}.transport-ready{color:#86efac}.transport-unavailable,.section-error{color:#fecaca}.section-error{margin:12px 0 0;padding:10px 12px;border:1px solid #9f3944;border-radius:9px;background:#481f2a}.muted{color:#9fb0c9;line-height:1.45}.discovery-warning{padding:10px;border:1px solid #c87d18;border-radius:9px;background:#4a3414;color:#fef3c7;font-weight:600}.discovery-options,.category-options,.filters,.queue-actions,.execution-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.category-options{margin:8px}.execution-actions{margin-top:14px}.counts{display:flex;flex-wrap:wrap;gap:7px}.counts span,.kind{padding:4px 9px;border-radius:999px;background:#2a3c59;text-transform:capitalize;font-size:12px}.kind-tweet{background:#075985}.kind-reply{background:#5b21b6}.kind-repost{background:#047857}.kind-like{background:#9f1239}.sort{background:transparent;color:#e2e8f0;border:0;padding:4px;margin:0;font-weight:700}.sort:hover{color:white;text-decoration:underline}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{padding:11px 8px;border-bottom:1px solid #263754;text-align:left;vertical-align:top}td:nth-child(4){min-width:260px;line-height:1.35}tr:hover td{background:#14243b}
  .attention-state{color:#ffd08a}.attention-detail,.attention-action{margin:6px 0 0;line-height:1.4}.attention-detail{color:#ffd6d6;font-size:12px}.attention-action{color:#b9cff0;font-size:12px;font-weight:650}
  .run-overlay{position:fixed;z-index:20;right:20px;bottom:20px;width:min(440px,calc(100vw - 40px));box-sizing:border-box;padding:18px;border:1px solid #2d78a8;border-radius:16px;background:#0d1b31;box-shadow:0 16px 50px #0009}.run-overlay-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.run-overlay h2{margin-bottom:0}.progress-track{height:8px;margin:15px 0;border-radius:999px;background:#23344d;overflow:hidden}.progress-track span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#16a8e8,#42d3a2);transition:width .25s ease}.progress-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px}.progress-kind{padding:9px 7px;border-radius:9px;background:#132640;text-transform:capitalize}.progress-kind span,.progress-kind small{display:block;color:#a8b8ce;font-size:11px}.progress-kind strong{display:block;margin:3px 0;color:white;font-size:16px}.progress-kind small{color:#f9be76}.current-target{margin:12px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  @media(max-width:760px){main{padding:14px}.panel{padding:14px}.section-heading,.run-overlay-top{align-items:flex-start}.filters label,.discovery-options label{width:100%;display:flex;align-items:center;justify-content:space-between}.filters select,.discovery-options input,.discovery-options select{min-width:0;max-width:62%}.queue-actions strong{width:100%;padding:5px}.execution-actions .btn{flex:1 1 160px}.progress-grid{grid-template-columns:repeat(2,1fr)}.queue-table,.queue-table tbody,.queue-table tr,.queue-table td{display:block;width:100%;box-sizing:border-box}.queue-table thead{display:none}.queue-table tr{margin:12px 0;padding:12px;border:1px solid #2b4262;border-radius:12px;background:#0b182b}.queue-table td{display:flex;gap:12px;align-items:flex-start;padding:6px 0;border:0;text-align:right;line-height:1.4}.queue-table td::before{content:attr(data-label);flex:0 0 72px;color:#8fa5c4;text-align:left;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.queue-table td.selection-cell{justify-content:flex-end;padding:0 0 7px}.queue-table td.selection-cell::before{content:'';flex:1}.queue-table td.item-text{display:block;text-align:left}.queue-table td.item-text::before{display:block;margin-bottom:5px}.queue-table tr:hover td{background:transparent}.queue-table .kind{margin-left:auto}.run-overlay{right:10px;bottom:10px;width:calc(100vw - 20px)}}
  @media(max-width:390px){header h1{font-size:24px}.btn{padding:8px 10px}.queue-actions .btn{width:100%;margin:3px 0}.category-options{display:grid;grid-template-columns:1fr 1fr}.category-options span{grid-column:1/-1}.run-overlay-top{display:block}.run-overlay-top .btn{margin:10px 0 0}.queue-table td::before{flex-basis:64px}}
</style>
