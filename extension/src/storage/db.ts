import type { Attempt, QueueItem, Run } from '../shared/contracts';
const DB = 'tweet-cleaner'; const VERSION = 1;
export class Store {
  private db?: IDBDatabase;
  async open() { if (this.db) return this.db; this.db = await new Promise((resolve, reject) => { const r = indexedDB.open(DB, VERSION); r.onupgradeneeded = () => { const db = r.result; for (const n of ['items','runs','attempts','meta']) if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, { keyPath: 'id' }); }; r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); return this.db; }
  async put(store: 'items'|'runs'|'attempts'|'meta', value: unknown) { const db = await this.open(); await new Promise<void>((resolve,reject) => { const t=db.transaction(store,'readwrite'); t.objectStore(store).put(value); t.oncomplete=()=>resolve(); t.onerror=()=>reject(t.error); }); }
  async get<T>(store: 'items'|'runs'|'attempts'|'meta', id: string): Promise<T|undefined> { const db=await this.open(); return new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}); }
  async all<T>(store: 'items'|'runs'|'attempts'): Promise<T[]> { const db=await this.open(); return new Promise((resolve,reject)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}); }
  async replaceItems(items: QueueItem[]) { const db=await this.open(); await new Promise<void>((resolve,reject)=>{const t=db.transaction('items','readwrite'), s=t.objectStore('items'); s.clear(); items.forEach(i=>s.put(i)); t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);}); }
  async activeRun(): Promise<Run|undefined> { return (await this.all<Run>('runs')).find(r => ['active','paused','interrupted'].includes(r.state)); }
  async claim(run: Run): Promise<boolean> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('runs', 'readwrite');
      const runs = transaction.objectStore('runs');
      let claimed = false;
      const request = runs.getAll();
      request.onsuccess = () => {
        const existing = request.result as Run[];
        // Never take ownership from a genuinely active dashboard. A new,
        // explicitly reviewed batch may supersede paused/interrupted work, but
        // the old run is retired so none of its items can be blindly replayed.
        if (existing.some(candidate => candidate.state === 'active')) return;
        existing.filter(candidate => candidate.state === 'paused' || candidate.state === 'interrupted').forEach(candidate => {
          runs.put({ ...candidate, state: 'cancelled' });
        });
        runs.put(run);
        claimed = true;
      };
      transaction.oncomplete = () => resolve(claimed);
      transaction.onerror = () => reject(transaction.error);
    });
  }
}
export const store = new Store(); export type { Attempt };
