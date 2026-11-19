import test from 'node:test';
import assert from 'node:assert/strict';
import {requestUrl,fetchLegs,fetchRemovalTests} from './fetch-amap-bicycle.mjs';
import {parseAmapBicycleV5} from './assemble-amap-map.mjs';
import {metres} from './diagnose-osm-route.mjs';
import * as client from './fetch-amap-bicycle.mjs';
import {assemble} from './assemble-amap-map.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const leg={start:[0,0],end:[0,.01]};
const result={status:'1',infocode:'10000',info:'OK',route:{paths:[{distance:'1112',steps:[{polyline:'0,0;0.01,0'}]}]}};

test('switching a web manifest to fetched API data removes stale web geometry and preserves the fixed reference',()=>{
  const manifest={actualStart:[0,0],actualEnd:[0,.01],legs:[{...leg,type:'main',name:'Synthetic',reason:'Synthetic provenance transition',referencePoints:[[0,0],[0,.01]],
    evidenceType:'amap-mobile-web',geometryEvidence:{source:'local-road-candidate'},responseFile:'old-web.json'}]};
  const saved=client.buildApiManifest(manifest,[], '2026-10-12');
  assert.equal(saved.legs[0].evidenceType,'amap-api-v5');
  assert.ok(!('geometryEvidence' in saved.legs[0]));
  assert.equal(saved.legs[0].responseFile,'leg-01.json');
  assert.deepEqual(saved.legs[0].referencePoints,manifest.legs[0].referencePoints);
  assert.equal(manifest.legs[0].evidenceType,'amap-mobile-web');
  const parsed=assemble(saved,[result]);
  assert.equal(parsed.report.validLegCount,1);
  assert.equal(parsed.data.routeParts[0].geometrySource,'amap-api-v5-polyline');
  assert.equal(parsed.report.status,'draft');
});

test('a shared paced request limits spacing across leg and deletion queries',async()=>{
  let clock=0;const times=[],waits=[];
  const paced=client.createPacedRequest(async()=>{times.push(clock);return {ok:true,json:async()=>result}},
    {intervalMs:400,now:()=>clock,sleep:async ms=>{waits.push(ms);clock+=ms}});
  await fetchLegs({legs:[leg,leg]},'synthetic-key',paced);
  await fetchRemovalTests({legs:[leg,leg]},'synthetic-key',paced);
  assert.deepEqual(times,[0,400,800]);assert.deepEqual(waits,[400,400]);
});

test('official v5 bicycle request uses longitude,latitude and polyline field',()=>{
  const url=requestUrl(leg,'test-only-key');
  assert.equal(url.origin,'https://restapi.amap.com');
  assert.equal(url.pathname,'/v5/direction/bicycling');
  assert.equal(url.searchParams.get('origin'),'0.000000,0.000000');
  assert.equal(url.searchParams.get('destination'),'0.010000,0.000000');
  assert.equal(url.searchParams.get('show_fields'),'polyline');
});

test('mocked AMap response is parsed without any network request',async()=>{
  const calls=[];
  const request=async url=>{calls.push(url);return {ok:true,json:async()=>result}};
  const responses=await fetchLegs({legs:[leg]},'test-only-key',request);
  assert.equal(calls.length,1);
  assert.equal(responses.length,1);
  assert.equal(responses[0].route.paths[0].distance,'1112');
});

test('China WGS-84 endpoints round-trip through AMap GCJ-02 request and response',()=>{
  const china={start:[39.900001,116.400001],end:[39.901001,116.402001]};
  const url=requestUrl(china,'test-only-key');
  const parsed=parseAmapBicycleV5({
    ...result,route:{paths:[{distance:'300',steps:[{polyline:url.searchParams.get('origin')+';'+url.searchParams.get('destination')}]}]}
  });
  assert.ok(metres(parsed.points[0],china.start)<2);
  assert.ok(metres(parsed.points.at(-1),china.end)<2);
});

test('failed AMap response is rejected and not treated as cycling evidence',async()=>{
  const request=async()=>({ok:true,json:async()=>({status:'0',info:'INVALID_USER_KEY'})});
  await assert.rejects(fetchLegs({legs:[leg]},'test-only-key',request),/failed/);
});

test('deletion-test requests skip documented mandatory boundaries only',async()=>{
  const calls=[];
  const request=async url=>{calls.push(url);return {ok:true,json:async()=>result}};
  const manifest={legs:[
    {start:[0,0],end:[0,.01],endMandatory:true},
    {start:[0,.01],end:[0,.02]},
    {start:[0,.02],end:[0,.03]}
  ]};
  const tests=await fetchRemovalTests(manifest,'test-only-key',request);
  assert.equal(tests.length,1);
  assert.equal(tests[0].boundaryAfterLeg,2);
  assert.equal(calls[0].searchParams.get('origin'),'0.010000,0.000000');
  assert.equal(calls[0].searchParams.get('destination'),'0.030000,0.000000');
});
test('group-level mandatory setting matches assembly and explicit false is not ignored',async()=>{
 const manifest={legs:[{...leg},{...leg}],navigationGroups:[{firstLeg:1,lastLeg:1,name:'one',reason:'synthetic',endMandatory:true},{firstLeg:2,lastLeg:2,name:'two',reason:'synthetic'}]};
 let calls=0;const request=async()=>{calls++;return {ok:true,json:async()=>result}};
 assert.equal((await fetchRemovalTests(manifest,'synthetic-key',request)).length,0);assert.equal(calls,0);
 manifest.legs[0].endMandatory=true;manifest.navigationGroups[0].endMandatory=false;
 assert.equal((await fetchRemovalTests(manifest,'synthetic-key',request)).length,1);assert.equal(calls,1);
});

test('a failed second request preserves the first raw success and failure body without retries',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cycling-capture-test-'));let calls=0;
  const failed={status:'0',info:'CUQPS_HAS_EXCEEDED_THE_LIMIT',infocode:'10021'};
  const request=async()=>({ok:true,status:200,text:async()=>JSON.stringify(++calls===1?result:failed)});
  await assert.rejects(client.collectToDirectory({legs:[leg,leg]},'synthetic-key',dir,request,{maxRequests:3}),/failed/);
  assert.equal(calls,2);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'leg-01.json'),'utf8')),result);
  const evidence=JSON.parse(await fs.readFile(path.join(dir,'request-002.json'),'utf8'));
  assert.deepEqual(evidence.body,failed);assert.equal(evidence.accepted,false);
  assert.equal(evidence.bodyFormat,'json');assert.equal(evidence.httpStatus,200);
  assert.equal((await fs.readdir(dir)).includes('manifest-with-responses.json'),false);
  const status=JSON.parse(await fs.readFile(path.join(dir,'collection-status.json'),'utf8'));
  assert.equal(status.attemptedRequests,2);assert.equal(status.acceptedResponses,1);assert.equal(status.automaticRetries,0);
  await assert.rejects(client.collectToDirectory({legs:[leg]},'synthetic-key',dir,request,{maxRequests:1}),/empty output/);
  assert.equal(calls,2);
});

test('HTTP non-JSON error evidence is preserved but any echoed Key is removed',async()=>{
  const evidence=[],key='synthetic-only&credential';
  const request=async()=>({ok:false,status:429,text:async()=>'<h1>limit '+key+' '+encodeURIComponent(key)+'</h1>'});
  await assert.rejects(client.fetchBicycleResponse(leg,key,request,{stage:'leg',index:1},async e=>evidence.push(e)),/429/);
  assert.equal(evidence.length,1);assert.equal(evidence[0].bodyFormat,'text');
  assert.equal(evidence[0].keyRedacted,true);assert.match(evidence[0].rawText,/limit/);
  assert.ok(!JSON.stringify(evidence).includes(key));assert.ok(!JSON.stringify(evidence).includes(encodeURIComponent(key)));
});

test('network error records absence of a response without leaking the request credential',async()=>{
  const evidence=[],key='synthetic-private-key';
  await assert.rejects(client.fetchBicycleResponse(leg,key,async()=>{throw Error('connection failed key='+key)}, {},async e=>evidence.push(e)),e=>!e.message.includes(key));
  assert.equal(evidence[0].bodyFormat,'unavailable');assert.equal(evidence[0].httpStatus,null);
  assert.ok(!('body' in evidence[0]));assert.ok(!JSON.stringify(evidence).includes(key));
});

test('navigation-group successes survive a later deletion failure and single-part groups do not query twice',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cycling-capture-groups-'));let calls=0;
  const manifest={legs:[leg,leg,leg],navigationGroups:[{firstLeg:1,lastLeg:1,name:'one',reason:'test'},{firstLeg:2,lastLeg:3,name:'two',reason:'test'}]};
  const request=async()=>({ok:true,status:200,text:async()=>JSON.stringify(++calls===5?{status:'0',info:'DAILY_QUERY_OVER_LIMIT'}:result)});
  await assert.rejects(client.collectToDirectory(manifest,'synthetic-key',dir,request,{maxRequests:5}),/failed/);
  assert.equal(calls,5);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'navigation-group-02.json'),'utf8')),result);
  const failed=JSON.parse(await fs.readFile(path.join(dir,'request-005.json'),'utf8'));
  assert.equal(failed.stage,'merge-after');assert.equal(failed.boundaryAfterLeg,1);
  assert.equal(failed.accepted,false);
});

test('fresh collection records actual request timestamps and replaces stale leg/group/deletion dates',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cycling-date-capture-'));
 const m={legs:[{...leg,queriedAt:'2000-01-01'},{...leg,queriedAt:'2000-01-01'},{...leg,queriedAt:'2000-01-01'}],navigationGroups:[{firstLeg:1,lastLeg:1,name:'one',reason:'test',queriedAt:'2000-01-01'},{firstLeg:2,lastLeg:3,name:'two',reason:'test',queriedAt:'2000-01-01'}]};
 await client.collectToDirectory(m,'synthetic-key',dir,async()=>({ok:true,status:200,json:async()=>result}),{maxRequests:5});
 const saved=JSON.parse(await fs.readFile(path.join(dir,'manifest-with-responses.json'),'utf8'));
 const read=async n=>JSON.parse(await fs.readFile(path.join(dir,'request-00'+n+'.json'),'utf8'));
 assert.equal(saved.legs[0].queriedAt,(await read(1)).requestedAt);assert.notEqual(saved.legs[0].queriedAt,'2000-01-01');
 assert.equal(saved.navigationGroups[0].queriedAt,saved.legs[0].queriedAt);
 assert.equal(saved.navigationGroups[1].queriedAt,(await read(4)).requestedAt);
 assert.equal(saved.removalTests[0].queriedAt,(await read(5)).requestedAt);
 assert.equal(m.legs[0].queriedAt,'2000-01-01');
});

test('paced collection timestamps refer to actual client invocation after Shanghai midnight',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cycling-paced-date-'));
 let clock=Date.parse('2026-10-12T15:59:59.990Z');const starts=[];
 const paced=client.createPacedRequest(async(url,options)=>{
  starts.push(new Date(clock).toISOString());assert.equal(Object.getOwnPropertySymbols(options).length,0);
  return {ok:true,status:200,json:async()=>result};
 },{intervalMs:2000,now:()=>clock,sleep:async ms=>{clock+=ms}});
 await client.collectToDirectory({legs:[{...leg,endMandatory:true},leg]},'synthetic-key',dir,paced,{maxRequests:2});
 const saved=JSON.parse(await fs.readFile(path.join(dir,'manifest-with-responses.json'),'utf8'));
 for(let i=0;i<2;i++){
  const evidence=JSON.parse(await fs.readFile(path.join(dir,`request-00${i+1}.json`),'utf8'));
  assert.equal(evidence.requestedAt,starts[i]);assert.equal(saved.legs[i].queriedAt,starts[i]);
 }
 assert.equal(starts[0],'2026-10-12T15:59:59.990Z');assert.equal(starts[1],'2026-10-12T16:00:01.990Z');
});

test('paced failure records its own invocation time, preserving the previous raw success',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cycling-paced-failure-'));let clock=1000,calls=0;
 const paced=client.createPacedRequest(async()=>{if(++calls===2)throw Error('SYNTHETIC_OFFLINE_FAILURE');return {ok:true,status:200,json:async()=>result}},
  {intervalMs:2000,now:()=>clock,sleep:async ms=>{clock+=ms}});
 await assert.rejects(client.collectToDirectory({legs:[leg,leg]},'synthetic-key',dir,paced,{maxRequests:3}),/SYNTHETIC_OFFLINE_FAILURE/);
 const e=JSON.parse(await fs.readFile(path.join(dir,'request-002.json'),'utf8'));
 assert.equal(e.requestedAt,new Date(3000).toISOString());assert.equal(e.httpStatus,null);assert.equal(e.bodyFormat,'unavailable');
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'leg-01.json'),'utf8')),result);assert.equal(calls,2);
});

test('unpaced public client receives only standard network arguments, without internal observers',async()=>{
 let count=0;
 await client.fetchBicycleResponse(leg,'synthetic-key',async(...args)=>{
  count++;assert.equal(args.length,2);assert.deepEqual(Reflect.ownKeys(args[1]),['signal']);
  return {ok:true,status:200,json:async()=>result};
 });
 assert.equal(count,1);
});
