import type { Account, Action, CapabilityState, Observation, QueueItem, RateLimitState } from '../../shared/contracts';
import { itemKey } from '../../shared/contracts';
import type { DiscoveryCategory } from '../../shared/messages';
import type { DiscoveryResult, MutationResult, ProbeResult, XTransport } from '../transport';
import { signedInHandle } from '../discovery';
import { extractOperationMetadata, featureValues, mainBundleUrls, metadataRevision, type MetadataMap, type OperationName } from './metadata';
import { TransactionIdGenerator } from './transaction';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const AUTHORIZATION = /^Bearer [A-Za-z0-9%._~-]{20,600}$/;
const CLIENT_UUID = /^[A-Fa-f0-9-]{20,64}$/;
const DECIMAL_ID = /^\d+$/;
const X_ORIGINS = new Set(['https://x.com', 'https://twitter.com']);

// Keep this check local to the content-script entry. Sharing its module with
// the service worker makes Rollup emit an ES-module import, but MV3 content
// scripts are classic scripts and cannot load that split chunk.
function allowedStaticAsset(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'abs.twimg.com'
      && /^\/responsive-web\/client-web\/(?:main\.[A-Za-z0-9_-]+\.js|ondemand\.s\.[A-Za-z0-9_-]+a\.js)$/.test(url.pathname)
      && !url.username && !url.password && !url.port && !url.search && !url.hash;
  } catch {
    return false;
  }
}

class DirectError extends Error {
  constructor(message: string, readonly category: string, readonly dispatched = false, readonly status?: number, readonly rateLimit?: RateLimitState) { super(message); }
}

interface GraphResponse { status: number; data: Record<string, unknown>; rateLimit: RateLimitState }

export function readCookie(name: string, source = document.cookie): string | undefined {
  return source.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))?.slice(name.length + 1);
}

export function validSessionHeader(name: string, value: string): boolean {
  return name === 'authorization' ? AUTHORIZATION.test(value) : name === 'x-client-uuid' ? CLIENT_UUID.test(value) : false;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function rateLimit(response: Response): RateLimitState {
  const read = (name: string) => { const value = Number(response.headers.get(name)); return Number.isFinite(value) ? value : undefined; };
  const reset = read('x-rate-limit-reset');
  return { limit: read('x-rate-limit-limit'), remaining: read('x-rate-limit-remaining'), resetAt: reset ? reset * 1000 : undefined, nextEligibleAt: Date.now() };
}

function graphqlErrors(body: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(body.errors) ? body.errors.map(asObject).filter((value): value is Record<string, unknown> => !!value) : [];
}

export function nonJsonResponseError(status: number, contentType: string | null, body: string): DirectError {
  const sample = body.slice(0, 4_096).toLowerCase();
  const looksLikeHtml = /text\/html/i.test(contentType ?? '') || /<html|<!doctype html/.test(sample);
  const looksLikeChallenge = /\/i\/flow\/(login|challenge)|log in|sign in|captcha|verify your identity|access denied/.test(sample);
  if (looksLikeChallenge) return new DirectError('X returned a sign-in or challenge page. Refresh X, complete it in the X tab, then retry discovery.', 'challenge', false, status);
  if (looksLikeHtml) return new DirectError(`X returned an unexpected HTML page (HTTP ${status}). Refresh the connected X tab, then retry discovery.`, 'response', false, status);
  return new DirectError(`X returned a non-JSON response (HTTP ${status}${contentType ? `, ${contentType}` : ''}). Refresh the connected X tab, then retry discovery.`, 'response', false, status);
}

function findKey(value: unknown, key: string): unknown {
  if (Array.isArray(value)) for (const child of value) { const match = findKey(child, key); if (match !== undefined) return match; }
  const object = asObject(value);
  if (object) {
    if (key in object) return object[key];
    for (const child of Object.values(object)) { const match = findKey(child, key); if (match !== undefined) return match; }
  }
}

function findResult(value: unknown): Record<string, unknown> | undefined {
  const object = asObject(value);
  if (!object) return undefined;
  if (typeof object.rest_id === 'string' || typeof object.__typename === 'string' && /Tombstone|Unavailable/.test(object.__typename)) return object;
  for (const child of Object.values(object)) {
    if (Array.isArray(child)) continue;
    const result = findResult(child);
    if (result) return result;
  }
}

function resultMatchesTarget(value: unknown, targetId: string): boolean {
  const result = findResult(value);
  if (!result) return true;
  const id = result.rest_id ?? legacy(result)?.id_str;
  return id === undefined || String(id) === targetId;
}

export function validMutationResponse(action: Action, targetId: string, body: Record<string, unknown>): boolean {
  if (!DECIMAL_ID.test(targetId)) return false;
  const data = asObject(body.data);
  if (!data) return false;
  if (action === 'unlike') return data.unfavorite_tweet === 'Done';
  if (action === 'delete_post') {
    const payload = asObject(data.delete_tweet);
    const results = asObject(payload?.tweet_results);
    return !!results && resultMatchesTarget(results, targetId);
  }
  const payload = asObject(data.unretweet);
  const results = asObject(payload?.source_tweet_results);
  return !!results && resultMatchesTarget(results, targetId);
}

function legacy(result: Record<string, unknown>): Record<string, unknown> | undefined {
  return asObject(result.legacy) ?? asObject(asObject(result.tweet)?.legacy);
}

function authorHandle(result: Record<string, unknown>): string | undefined {
  const core = asObject(result.core) ?? asObject(asObject(result.tweet)?.core);
  const user = asObject(asObject(core?.user_results)?.result);
  return String(asObject(user?.core)?.screen_name ?? asObject(user?.legacy)?.screen_name ?? '') || undefined;
}

export function resultUnavailable(result?: Record<string, unknown>): boolean {
  // A missing parsed result is a schema/readback failure, not evidence that
  // the target no longer exists. Only an explicit X unavailable result can
  // safely count as already done.
  return !!result && /Tombstone|Unavailable|NotFound/.test(String(result.__typename ?? ''));
}

function initialFeatureDefaults(root: Document): Record<string, boolean> {
  for (const script of root.scripts) {
    const match = script.textContent?.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*});?\s*$/);
    if (!match) continue;
    try {
      const state = JSON.parse(match[1]);
      const config = state?.featureSwitch?.defaultConfig ?? {};
      return Object.fromEntries(Object.entries(config).map(([name, entry]) => [name, Boolean((entry as { value?: unknown })?.value)]));
    } catch { /* Keep the fail-closed empty feature map. */ }
  }
  return {};
}

function entries(body: Record<string, unknown>): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const object = asObject(value);
    if (!object) return;
    if (typeof object.entryId === 'string') found.push(object);
    Object.values(object).forEach(visit);
  };
  visit(body.data);
  return found;
}

function cursor(body: Record<string, unknown>): string | undefined {
  const entry = entries(body).find(candidate => String(candidate.entryId).startsWith('cursor-bottom'));
  return entry?.content ? String(asObject(entry.content)?.value ?? '') || undefined : undefined;
}

function timelineResult(entry: Record<string, unknown>): Record<string, unknown> | undefined {
  return findResult(asObject(asObject(entry.content)?.itemContent)?.tweet_results)
    ?? findResult(asObject(asObject(asObject(entry.item)?.itemContent)?.tweet_results));
}

export function parseTimeline(body: Record<string, unknown>, category: DiscoveryCategory, account: Account): QueueItem[] {
  const items = new Map<string, QueueItem>();
  for (const entry of entries(body)) {
    if (!String(entry.entryId).includes('tweet-')) continue;
    const result = timelineResult(entry);
    if (!result || resultUnavailable(result)) continue;
    const post = legacy(result);
    if (!post) continue;
    const repostResult = findResult(post.retweeted_status_result);
    const target = repostResult ?? result;
    const targetLegacy = legacy(target) ?? post;
    const targetId = String(target.rest_id ?? targetLegacy.id_str ?? '');
    if (!DECIMAL_ID.test(targetId)) continue;
    const author = authorHandle(target);
    const own = author?.toLowerCase() === account.handle.toLowerCase();
    const isReply = Boolean(post.in_reply_to_user_id_str);
    const isRepost = !!repostResult;
    // UserTweetsAndReplies includes originals and reposts as well as replies.
    // Apply the requested category after parsing rather than trusting the
    // timeline name to be a strict category filter.
    if (category === 'posts' && (isReply || isRepost)) continue;
    if (category === 'replies' && (!isReply || isRepost)) continue;
    if (category === 'reposts' && !isRepost) continue;
    const action: Action | undefined = category === 'likes' ? 'unlike' : isRepost ? 'undo_repost' : own ? 'delete_post' : undefined;
    if (!action) continue;
    const kind = action === 'unlike' ? 'like' : action === 'undo_repost' ? 'repost' : isReply ? 'reply' : 'tweet';
    const createdAt = Number.isFinite(Date.parse(String(targetLegacy.created_at ?? post.created_at ?? ''))) ? new Date(String(targetLegacy.created_at ?? post.created_at)).toISOString() : undefined;
    const occurredAt = action === 'delete_post' ? createdAt : undefined;
    const id = itemKey(action, targetId);
    items.set(id, { id, targetId, action, kind, author, permalink: author ? `https://x.com/${author}/status/${targetId}` : undefined, text: String(targetLegacy.full_text ?? ''), occurredAt, createdAt, source: 'page', selected: false, state: 'pending' });
  }
  return [...items.values()];
}

export function timelinePageKey(body: Record<string, unknown>): string | undefined {
  const ids = entries(body).filter(entry => String(entry.entryId).includes('tweet-')).map(entry => {
    const result = timelineResult(entry);
    const post = result && legacy(result);
    const repost = post && findResult(post.retweeted_status_result);
    const target = repost ?? result;
    return String(target?.rest_id ?? legacy(target ?? {})?.id_str ?? '');
  }).filter(id => DECIMAL_ID.test(id));
  return ids.length ? ids.join(',') : undefined;
}

export class DirectXTransport implements XTransport {
  readonly kind = 'direct' as const;
  private authorization?: string;
  private clientUuid?: string;
  private metadata?: MetadataMap;
  private revision?: string;
  private generator?: TransactionIdGenerator;
  private account?: Account;
  private defaults: Record<string, boolean> = {};
  private controllers = new Map<string, AbortController>();

  constructor(private readonly root: Document) {}

  capture(name: string, value: string): void {
    if (!validSessionHeader(name, value)) return;
    if (name === 'authorization') this.authorization = value;
    if (name === 'x-client-uuid') this.clientUuid = value;
  }

  cancel(runId: string): void { this.controllers.get(runId)?.abort(); }

  private challenge(): boolean {
    return /^\/i\/flow\/(login|challenge)|^\/account\/access/.test(location.pathname) || !!this.root.querySelector('iframe[src*="captcha"], input[autocomplete="one-time-code"]');
  }

  private async text(url: string, signal?: AbortSignal): Promise<string> {
    const parsed = new URL(url, location.href);
    if (!X_ORIGINS.has(parsed.origin) && parsed.hostname !== 'abs.twimg.com') throw new DirectError('Blocked non-X request.', 'metadata');
    if (parsed.hostname === 'abs.twimg.com') {
      if (!allowedStaticAsset(parsed.href)) throw new DirectError('Blocked unknown X metadata asset.', 'metadata');
      if (signal?.aborted) throw new DirectError('The X metadata request was cancelled.', 'cancelled');
      let removeAbort: () => void = () => {};
      const aborted = new Promise<never>((_, reject) => {
        const stop = () => reject(new DirectError('The X metadata request was cancelled.', 'cancelled'));
        signal?.addEventListener('abort', stop, { once: true });
        removeAbort = () => signal?.removeEventListener('abort', stop);
      });
      try {
        const pending = chrome.runtime.sendMessage({ type: 'fetch-x-static-asset', url: parsed.href }) as Promise<{ ok: boolean; text?: string; error?: string; status?: number }>;
        const result = await (signal ? Promise.race([pending, aborted]) : pending);
        if (!result?.ok || typeof result.text !== 'string') throw new DirectError(result?.error ?? 'X metadata asset request failed.', 'metadata', false, result?.status);
        return result.text;
      } catch (error) {
        if (error instanceof DirectError) throw error;
        throw new DirectError('The public X metadata asset could not be fetched.', 'metadata');
      } finally {
        removeAbort();
      }
    }
    let response: Response;
    try { response = await fetch(parsed.href, { credentials: 'include', signal }); }
    catch { throw new DirectError('The signed-in X page could not be fetched. Refresh the X tab and retry.', 'metadata'); }
    if (!response.ok) throw new DirectError(`X metadata request failed with HTTP ${response.status}.`, 'metadata', false, response.status);
    const value = await response.text();
    if (new TextEncoder().encode(value).length > MAX_RESPONSE_BYTES * 8) throw new DirectError('X metadata response exceeded the safety limit.', 'metadata');
    return value;
  }

  private async initialize(): Promise<void> {
    if (this.metadata && this.generator && this.revision) return;
    if (this.challenge()) throw new DirectError('X requires login or challenge verification.', 'challenge');
    if (!this.authorization) throw new DirectError('No authenticated X web request has been observed. Refresh the X tab.', 'authentication');
    if (!readCookie('ct0')) throw new DirectError('X CSRF state is unavailable. Refresh the X tab.', 'authentication');
    const home = await this.text('https://x.com/home');
    const urls = mainBundleUrls(home).concat(mainBundleUrls(this.root.documentElement?.outerHTML ?? '', location.href));
    const metadata: MetadataMap = {};
    for (const url of [...new Set(urls)]) Object.assign(metadata, extractOperationMetadata(await this.text(url)));
    const required: OperationName[] = ['UserByScreenName', 'UserTweetsAndReplies', 'Likes', 'DeleteTweet', 'DeleteRetweet', 'UnfavoriteTweet', 'TweetResultByRestId'];
    const missing = required.filter(name => !metadata[name]);
    if (missing.length) throw new DirectError(`X operation metadata is missing: ${missing.join(', ')}.`, 'metadata');
    this.generator = await TransactionIdGenerator.create(home, url => this.text(url));
    this.metadata = metadata;
    this.revision = metadataRevision(metadata);
    this.defaults = initialFeatureDefaults(this.root);
  }

  private invalidate(): void { this.metadata = undefined; this.generator = undefined; this.revision = undefined; this.account = undefined; }

  private async request(runId: string, operation: OperationName, variables: Record<string, unknown>, method: 'GET' | 'POST'): Promise<GraphResponse> {
    await this.initialize();
    if (this.challenge()) throw new DirectError('X requires login or challenge verification.', 'challenge');
    const metadata = this.metadata?.[operation];
    if (!metadata || !this.generator || !this.authorization) throw new DirectError(`X operation ${operation} is unavailable.`, 'metadata');
    const url = new URL(`/i/api/graphql/${metadata.queryId}/${operation}`, 'https://x.com');
    const features = featureValues(metadata, this.defaults);
    let body: string | undefined;
    if (method === 'GET') {
      url.searchParams.set('variables', JSON.stringify(variables));
      url.searchParams.set('features', JSON.stringify(features));
      url.searchParams.set('fieldToggles', JSON.stringify({ withArticlePlainText: false }));
    } else body = JSON.stringify({ variables, queryId: metadata.queryId });
    const csrf = readCookie('ct0');
    if (!csrf) throw new DirectError('X CSRF state disappeared before dispatch.', 'authentication');
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    const headers: Record<string, string> = { accept: '*/*', authorization: this.authorization, 'content-type': 'application/json', 'x-csrf-token': csrf, 'x-twitter-active-user': 'yes', 'x-twitter-auth-type': 'OAuth2Session' };
    if (this.clientUuid) headers['x-client-uuid'] = this.clientUuid;
    headers['x-client-transaction-id'] = await this.generator.generate(method, url.pathname);
    let response: Response;
    try { response = await fetch(url.href, { method, headers, body, credentials: 'include', signal: controller.signal }); }
    catch (error) {
      this.controllers.delete(runId);
      if (controller.signal.aborted) throw new DirectError('The X request was cancelled.', 'cancelled', method === 'POST');
      throw new DirectError('The X request failed after dispatch.', method === 'POST' ? 'network_after_dispatch' : 'network_before_dispatch', method === 'POST');
    }
    this.controllers.delete(runId);
    const limits = rateLimit(response);
    if (response.status === 401 || response.status === 403) { this.invalidate(); throw new DirectError(`X rejected the signed-in session with HTTP ${response.status}.`, 'authentication', method === 'POST', response.status, limits); }
    if (response.status === 429) throw new DirectError('X rate limit reached.', 'rate_limit', method === 'POST', 429, limits);
    const text = await response.text();
    if (new TextEncoder().encode(text).length > MAX_RESPONSE_BYTES) throw new DirectError('X response exceeded the safety limit.', 'response', method === 'POST', response.status, limits);
    let data: Record<string, unknown>;
    try { data = JSON.parse(text); } catch {
      const classified = nonJsonResponseError(response.status, response.headers.get('content-type'), text);
      throw new DirectError(classified.message, classified.category, method === 'POST', response.status, limits);
    }
    const errors = graphqlErrors(data);
    if (!response.ok || errors.length) {
      if ([400, 404].includes(response.status) || errors.some(error => /operation|query.?id|persisted query/i.test(String(error.message ?? '')))) this.invalidate();
      const missing = method === 'GET' && errors.length > 0 && errors.every(error => [34, 144].includes(Number(error.code)) || /not found|does not exist|deleted/i.test(String(error.message ?? '')));
      throw new DirectError(`X ${operation} returned an error.`, missing ? 'not_found' : 'response', method === 'POST', response.status, limits);
    }
    return { status: response.status, data, rateLimit: limits };
  }

  private async resolveAccount(runId: string): Promise<Account> {
    const handle = signedInHandle(this.root);
    if (!handle) throw new DirectError('The signed-in X account is not visible.', 'account');
    if (this.account?.handle.toLowerCase() === handle.toLowerCase()) return this.account;
    const response = await this.request(runId, 'UserByScreenName', { screen_name: handle, withSafetyModeUserFields: true }, 'GET');
    const result = findResult(response.data.data);
    const id = String(result?.rest_id ?? '');
    if (!DECIMAL_ID.test(id)) throw new DirectError('The signed-in X user ID could not be resolved.', 'account');
    this.account = { id, handle, displayName: String(legacy(result!)?.name ?? '') || undefined };
    return this.account;
  }

  async probe(): Promise<ProbeResult> {
    try {
      await this.initialize();
      const account = await this.resolveAccount('probe');
      return { capability: { state: 'ready', detail: 'Direct X requests are ready.', checkedAt: Date.now() }, account, metadataRevision: this.revision };
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Direct X requests are unavailable.';
      return { capability: { state: 'unavailable', detail, checkedAt: Date.now() } };
    }
  }

  private async exact(runId: string, targetId: string): Promise<{ result?: Record<string, unknown>; response: GraphResponse }> {
    const response = await this.request(runId, 'TweetResultByRestId', { tweetId: targetId, withCommunity: false, includePromotedContent: false, withVoice: false }, 'GET');
    return { result: findResult(response.data.data), response };
  }

  async inspect(runId: string, targetId: string, action: Action, account: Account): Promise<MutationResult> {
    if (!DECIMAL_ID.test(targetId)) throw new DirectError('Invalid target ID.', 'metadata');
    const current = await this.resolveAccount(runId);
    if (current.id !== account.id || current.handle.toLowerCase() !== account.handle.toLowerCase()) throw new DirectError('The signed-in X account changed.', 'account');
    try {
      const { result, response } = await this.exact(runId, targetId);
      if (action === 'delete_post') {
        if (resultUnavailable(result)) return { observation: { targetId, state: 'inactive', account: current }, metadataRevision: this.revision, rateLimit: response.rateLimit };
        if (!result) return { observation: { targetId, state: 'ambiguous', account: current, detail: 'X did not return the exact target for inspection.' }, metadataRevision: this.revision, rateLimit: response.rateLimit };
        const author = authorHandle(result!);
        const state = author?.toLowerCase() === current.handle.toLowerCase() ? 'active' : 'ambiguous';
        return { observation: { targetId, state, account: current, detail: state === 'ambiguous' ? 'The exact target is not owned by the connected account.' : undefined }, metadataRevision: this.revision, rateLimit: response.rateLimit };
      }
      if (resultUnavailable(result)) return { observation: { targetId, state: 'inactive', account: current }, metadataRevision: this.revision, rateLimit: response.rateLimit };
      if (!result) return { observation: { targetId, state: 'ambiguous', account: current, detail: 'X did not return the exact target for inspection.' }, metadataRevision: this.revision, rateLimit: response.rateLimit };
      const stateValue = action === 'unlike' ? legacy(result!)?.favorited : legacy(result!)?.retweeted;
      return { observation: { targetId, state: stateValue === true ? 'active' : stateValue === false ? 'inactive' : 'ambiguous', account: current, detail: typeof stateValue !== 'boolean' ? 'X did not return the expected action state.' : undefined }, metadataRevision: this.revision, rateLimit: response.rateLimit };
    } catch (error) {
      if (error instanceof DirectError && error.category === 'not_found' && !error.dispatched) return { observation: { targetId, state: 'inactive', account: current, detail: 'The exact target is no longer available.' }, metadataRevision: this.revision, rateLimit: error.rateLimit };
      throw error;
    }
  }

  async mutate(runId: string, targetId: string, action: Action, account: Account): Promise<MutationResult> {
    const before = await this.inspect(runId, targetId, action, account);
    if (before.observation.state !== 'active') return before;
    if (signedInHandle(this.root)?.toLowerCase() !== account.handle.toLowerCase()) throw new DirectError('The signed-in X account changed before dispatch.', 'account');
    const { operation, variables } = mutationRequest(action, targetId);
    const mutation = await this.request(runId, operation, variables, 'POST');
    if (!validMutationResponse(action, targetId, mutation.data)) throw new DirectError(`X ${operation} response could not be verified.`, 'response', true, mutation.status, mutation.rateLimit);
    let after: MutationResult;
    try { after = await this.inspect(runId, targetId, action, account); }
    catch { throw new DirectError(`X ${operation} was accepted but exact-target readback failed.`, 'verification', true, mutation.status, mutation.rateLimit); }
    if (after.observation.state !== 'inactive') throw new DirectError(`X ${operation} readback was inconclusive.`, 'verification', true, mutation.status, mutation.rateLimit);
    return { ...after, operation, httpStatus: mutation.status, dispatched: true, rateLimit: mutation.rateLimit };
  }

  async discover(runId: string, category: DiscoveryCategory, account: Account, nextCursor?: string): Promise<DiscoveryResult> {
    const current = await this.resolveAccount(runId);
    if (current.id !== account.id || current.handle.toLowerCase() !== account.handle.toLowerCase()) throw new DirectError('The signed-in X account changed.', 'account');
    const operation: OperationName = category === 'likes' ? 'Likes' : 'UserTweetsAndReplies';
    const variables: Record<string, unknown> = { userId: account.id, count: 20, includePromotedContent: category !== 'likes', withVoice: true };
    if (nextCursor) variables.cursor = nextCursor;
    const response = await this.request(runId, operation, variables, 'GET');
    const following = cursor(response.data);
    return { items: parseTimeline(response.data, category, account), cursor: following, pageKey: timelinePageKey(response.data), complete: !following, rateLimit: response.rateLimit };
  }
}

export function mutationRequest(action: Action, targetId: string): { operation: OperationName; variables: Record<string, unknown> } {
  if (!DECIMAL_ID.test(targetId)) throw new Error('Invalid target ID.');
  return action === 'delete_post'
    ? { operation: 'DeleteTweet', variables: { tweet_id: targetId, dark_request: false } }
    : action === 'undo_repost'
      ? { operation: 'DeleteRetweet', variables: { source_tweet_id: targetId } }
      : { operation: 'UnfavoriteTweet', variables: { tweet_id: targetId } };
}

export function directError(error: unknown): { error: string; category?: string; dispatched?: boolean; httpStatus?: number; rateLimit?: RateLimitState } {
  return error instanceof DirectError
    ? { error: error.message, category: error.category, dispatched: error.dispatched, httpStatus: error.status, rateLimit: error.rateLimit }
    : { error: error instanceof Error ? error.message : 'The direct X request failed safely.', category: 'response' };
}
