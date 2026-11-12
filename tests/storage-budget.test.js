import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState} from '../extension/lib/core.js';
import {prepareStorage,stateBytes,STATE_BUDGET,RECOVERY_BUDGET} from '../extension/lib/storage-budget.js';
test('UTF-8 state budget includes all sources, captures, queues and history',()=>{
  const state=initialState();state.capture.entries=[{handle:'fixture',reason:'界'.repeat(STATE_BUDGET/3)}];
  assert.ok(stateBytes(state)>STATE_BUDGET);assert.throws(()=>prepareStorage(state),/too large/);
  assert.doesNotThrow(()=>prepareStorage(state,{critical:true}));
  state.capture.entries[0].reason='x'.repeat(RECOVERY_BUDGET);assert.throws(()=>prepareStorage(state,{critical:true}),/too large/);
});
test('budget trims expendable logs/history without dropping active jobs or private entries',()=>{
  const state=initialState();state.entries=[{handle:'private',status:'pending'}];
  state.logs=Array.from({length:1001},()=>({message:'old'}));state.queue=Array.from({length:1100},(_,i)=>({id:String(i),status:'done'}));state.queue.push({id:'active',status:'uncertain'});
  prepareStorage(state);assert.equal(state.queue.length,1001);assert.equal(state.queue.at(-1).id,'active');assert.equal(state.entries.length,1);assert.equal(state.logs.length,500);
});
