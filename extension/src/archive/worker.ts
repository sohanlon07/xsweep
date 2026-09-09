import { parseArchive } from './parser';
self.onmessage = async (event: MessageEvent<{ file: File }>) => { try { postMessage({ ok:true, items:await parseArchive(event.data.file) }); } catch (error) { postMessage({ ok:false, error:error instanceof Error ? error.message : 'Archive parsing failed' }); } };
