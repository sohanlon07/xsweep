import type { Account, Action, CapabilityState, Observation, QueueItem, RateLimitState, TransportKind } from './contracts';
export type DiscoveryCategory = 'posts' | 'replies' | 'likes' | 'reposts';
export type Message =
 | { type: 'get-account' }
 | { type: 'probe'; transport: TransportKind }
 | { type: 'direct-discover'; runId: string; category: DiscoveryCategory; handle: string; cursor?: string }
 | { type: 'cancel'; runId: string; attemptId?: string }
 | { type: 'inspect'; runId: string; attemptId: string; itemId: string; action: Action; targetId: string; accountId: string; accountHandle: string; transport?: TransportKind }
 | { type: 'mutate'; runId: string; attemptId: string; itemId: string; action: Action; targetId: string; accountId: string; accountHandle: string; transport?: TransportKind };
export function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  if (m.type === 'get-account') return true;
  if (m.type === 'probe') return m.transport === 'direct';
  if (m.type === 'cancel') return typeof m.runId === 'string' && (m.attemptId === undefined || typeof m.attemptId === 'string');
  if (m.type === 'direct-discover') return typeof m.runId === 'string' && ['posts','replies','likes','reposts'].includes(String(m.category)) && typeof m.handle === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(m.handle) && (m.cursor === undefined || typeof m.cursor === 'string');
  return (m.type === 'inspect' || m.type === 'mutate') && typeof m.runId === 'string' && typeof m.attemptId === 'string' && typeof m.itemId === 'string' && ['delete_post','unlike','undo_repost'].includes(String(m.action)) && typeof m.targetId === 'string' && /^\d+$/.test(String(m.targetId)) && typeof m.accountId === 'string' && m.accountId.length > 0 && typeof m.accountHandle === 'string' && /^[A-Za-z0-9_]{1,15}$/.test(m.accountHandle) && m.transport === 'direct';
}
export type ErrorResponse = { ok: false; error: string; category?: string; dispatched?: boolean; httpStatus?: number; rateLimit?: RateLimitState };
export type OperationResponse = { ok: true; observation: Observation; metadataRevision?: string; rateLimit?: RateLimitState; operation?: string; httpStatus?: number; dispatched?: boolean } | ErrorResponse;
export type ProbeResponse = { ok: true; capability: CapabilityState; account?: Account; metadataRevision?: string } | ErrorResponse;
export type DirectDiscoveryResponse = { ok: true; items: QueueItem[]; cursor?: string; pageKey?: string; complete: boolean; rateLimit?: RateLimitState } | ErrorResponse;
export type ContentResponse = OperationResponse | ProbeResponse | DirectDiscoveryResponse | { ok: true; cancelled: true };
