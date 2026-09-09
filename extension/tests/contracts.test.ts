import { describe,expect,it } from 'vitest'; import { isMessage } from '../src/shared/messages';
describe('message validation',()=>{it('rejects malformed destructive work',()=>{expect(isMessage({type:'mutate',targetId:'x'})).toBe(false);expect(isMessage({type:'mutate',runId:'r',attemptId:'a',itemId:'i',action:'delete_post',targetId:'1'})).toBe(true);});});
