export type Action = 'delete_post' | 'unlike' | 'undo_repost';
export type ItemKind = 'tweet' | 'reply' | 'repost' | 'like';
export type TransportKind = 'direct';
export type ItemState = 'pending' | 'inspecting' | 'awaiting_confirmation' | 'executing' | 'verifying' | 'succeeded' | 'already_done' | 'skipped' | 'needs_attention' | 'failed';
export type FailureCategory = 'cancelled' | 'account' | 'authentication' | 'challenge' | 'metadata' | 'rate_limit' | 'network_before_dispatch' | 'network_after_dispatch' | 'response' | 'verification';
export interface CapabilityState { state: 'ready' | 'unavailable'; detail: string; checkedAt: number }
export interface RateLimitState { limit?: number; remaining?: number; resetAt?: number; nextEligibleAt: number }
export interface Account { id: string; handle: string; displayName?: string }
export interface QueueItem { id: string; action: Action; kind: ItemKind; targetId: string; permalink?: string; text: string; author?: string; occurredAt?: string; createdAt?: string; source: 'archive' | 'page'; selected: boolean; state: ItemState; ambiguity?: string }
export interface Run { id: string; revision: number; tabId: number; account: Account; itemIds: string[]; dryRun: boolean; state: 'active' | 'paused' | 'cancelled' | 'interrupted' | 'complete'; nextEligibleAt: number; activeAttemptId?: string; transport?: TransportKind; metadataRevision?: string; capability?: CapabilityState; rateLimit?: RateLimitState }
export interface Attempt { id: string; runId: string; itemId: string; state: 'started' | 'dispatched' | 'failed' | 'uncertain' | 'verified'; result?: ItemState; createdAt: number; detail?: string; operation?: string; dispatchedAt?: number; httpStatus?: number; verification?: 'not_started' | 'confirmed' | 'inconclusive'; failureCategory?: FailureCategory }
export interface Observation { targetId: string; account?: Account; state: 'active' | 'inactive' | 'not_found' | 'ambiguous'; detail?: string }
export const isDecimalId = (value: unknown): value is string => typeof value === 'string' && /^\d+$/.test(value);
export function itemKey(action: Action, targetId: string) { return `${action}:${targetId}`; }
