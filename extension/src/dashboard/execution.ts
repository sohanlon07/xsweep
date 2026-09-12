import type { RateLimitState } from '../shared/contracts';

export function adaptiveDelay(rateLimit?: RateLimitState, now = Date.now(), random = Math.random()): number {
  const jitteredBase = 3000 + Math.min(2000, Math.floor(random * 2001));
  if (!rateLimit?.limit || rateLimit.remaining === undefined) return jitteredBase;
  if (rateLimit.remaining <= 1 && rateLimit.resetAt && rateLimit.resetAt > now) return rateLimit.resetAt - now + 1000 + Math.min(1000, Math.floor(random * 1001));
  const ratio = rateLimit.remaining / rateLimit.limit;
  return Math.floor(jitteredBase * (ratio < 0.2 ? 2.5 : ratio < 0.5 ? 1.5 : 1));
}

export async function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false;
  return new Promise(resolve => {
    const done = (completed: boolean) => { clearTimeout(timer); signal.removeEventListener('abort', cancelled); resolve(completed); };
    const cancelled = () => done(false);
    const timer = setTimeout(() => done(true), milliseconds);
    signal.addEventListener('abort', cancelled, { once: true });
  });
}
