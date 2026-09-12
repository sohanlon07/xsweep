import type { Account, Action, CapabilityState, Observation, QueueItem, RateLimitState, TransportKind } from '../shared/contracts';
import type { DiscoveryCategory } from '../shared/messages';

export interface ProbeResult { capability: CapabilityState; account?: Account; metadataRevision?: string }
export interface DiscoveryResult { items: QueueItem[]; cursor?: string; pageKey?: string; complete: boolean; rateLimit?: RateLimitState }
export interface MutationResult { observation: Observation; metadataRevision?: string; rateLimit?: RateLimitState; operation?: string; httpStatus?: number; dispatched?: boolean }

export interface XTransport {
  readonly kind: TransportKind;
  probe(): Promise<ProbeResult>;
  discover?(runId: string, category: DiscoveryCategory, account: Account, cursor?: string): Promise<DiscoveryResult>;
  inspect(runId: string, targetId: string, action: Action, account: Account): Promise<MutationResult>;
  mutate(runId: string, targetId: string, action: Action, account: Account): Promise<MutationResult>;
  cancel(runId: string): void;
}
