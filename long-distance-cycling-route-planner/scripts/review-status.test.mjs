import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewStatus} from './review-status.mjs';
import {assemble} from './assemble-amap-map.mjs';
const valid=()=>({routeAndRoadsChecked:true,navDeletionChecked:true,accessChecked:true,checkedAt:'2026-10-12',evidence:'Synthetic review fixture only; not a real road approval'});
test('missing review is actionable agent work, not automatically a user blocker',()=>{
 const r=reviewStatus();assert.equal(r.complete,false);assert.equal(r.pendingChecks.length,3);assert.ok(r.pendingChecks.every(x=>x.owner==='agent'));assert.equal(r.deviceAcceptance.status,'not-tested');
});
test('access gap is distinguished from already checked roads and navigation',()=>{
 const r=reviewStatus({...valid(),accessChecked:false});assert.deepEqual(r.pendingChecks.map(x=>x.code),['access-review']);assert.ok(r.checks.find(x=>x.code==='navigation-review').passed);
});
test('all true flags with an invalid review date cannot certify a route',()=>{
 for(const checkedAt of ['', 'not-a-date', null])assert.equal(reviewStatus({...valid(),checkedAt}).complete,false);
});
test('explicit unresolved field/device work cannot be concealed by true flags',()=>{
 const r=reviewStatus({...valid(),pendingChecks:[{code:'gate',description:'Synthetic uncertain gate access',owner:'field',action:'Inspect gate after exhausting desktop evidence'}]});assert.equal(r.complete,false);assert.equal(r.pendingChecks.length,1);assert.equal(r.pendingChecks[0].owner,'field');
 assert.throws(()=>reviewStatus({...valid(),pendingChecks:[{code:'x',description:'unknown',owner:'other',action:'ask'}]}),/pending check/);
});
test('assembly exports precise readiness without enabling draft navigation',()=>{
 const m={actualStart:[0,0],actualEnd:[0,.01],queriedAt:'2026-10-12',legs:[{type:'main',name:'Synthetic main',reason:'Synthetic endpoint',start:[0,0],end:[0,.01],referencePoints:[[0,0],[0,.01]]}],review:{...valid(),accessChecked:false}};
 const response={status:'1',infocode:'10000',route:{paths:[{distance:'1112',steps:[{polyline:'0,0;0.01,0'}]}]}};
 const r=assemble(m,[response]);assert.equal(r.report.status,'draft');assert.equal(r.data.totalKm,null);assert.equal(r.report.reviewStatus.pendingChecks[0].code,'access-review');assert.deepEqual(r.data.reviewStatus,r.report.reviewStatus);
 m.review=valid();const ready=assemble(m,[response]);assert.equal(ready.report.status,'complete');assert.equal(ready.report.reviewStatus.deviceAcceptance.status,'not-tested');
});
