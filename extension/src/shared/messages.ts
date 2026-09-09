import type { Action, Observation } from './contracts';
export type Message =
 | { type: 'get-account' }
 | { type: 'inspect'; runId: string; attemptId: string; itemId: string; action: Action; targetId: string }
 | { type: 'mutate'; runId: string; attemptId: string; itemId: string; action: Action; targetId: string };
export function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  if (m.type === 'get-account') return true;
  return (m.type === 'inspect' || m.type === 'mutate') && typeof m.runId === 'string' && typeof m.attemptId === 'string' && typeof m.itemId === 'string' && ['delete_post','unlike','undo_repost'].includes(String(m.action)) && typeof m.targetId === 'string' && /^\d+$/.test(String(m.targetId));
}
export type ContentResponse = { ok: true; observation: Observation } | { ok: false; error: string };
