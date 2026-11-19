import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchNavigationGroups,fetchRemovalTests,navigationSpans,buildApiManifest} from './fetch-amap-bicycle.mjs';
const body={status:'1',infocode:'10000',route:{paths:[{distance:'1112',steps:[{polyline:'0,0;0.01,0'}]}]}};
const manifest=()=>({legs:[0,1,2].map(i=>({start:[0,i*.01],end:[0,(i+1)*.01]})),navigationGroups:[{firstLeg:1,lastLeg:1,name:'One',reason:'Synthetic group'},{firstLeg:2,lastLeg:3,name:'Two',reason:'Synthetic main and return'}]});
test('group captures reuse singleton responses and query a mixed span once',async()=>{
 const calls=[],m=manifest();const result=await fetchNavigationGroups(m,'synthetic-key',[body,body,body],async url=>{calls.push(url);return {ok:true,json:async()=>body}});
 assert.equal(calls.length,1);assert.equal(result.length,2);assert.equal(calls[0].searchParams.get('origin'),'0.010000,0.000000');assert.equal(calls[0].searchParams.get('destination'),'0.030000,0.000000');
 const saved=buildApiManifest(m,[],'2026-10-12');assert.equal(saved.navigationGroups[1].responseFile,'navigation-group-02.json');assert.equal(saved.navigationGroups[1].evidenceType,'amap-api-v5');
});
test('deletion captures test true manual boundaries, not internal composition cuts',async()=>{
 const calls=[];const result=await fetchRemovalTests(manifest(),'synthetic-key',async url=>{calls.push(url);return {ok:true,json:async()=>body}});
 assert.equal(calls.length,1);assert.equal(result[0].boundaryAfterLeg,1);assert.equal(calls[0].searchParams.get('destination'),'0.030000,0.000000');
 const m=manifest();m.navigationGroups[1].firstLeg=3;assert.throws(()=>navigationSpans(m),/partition/);
});
