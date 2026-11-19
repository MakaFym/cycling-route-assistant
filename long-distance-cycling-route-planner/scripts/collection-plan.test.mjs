import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {planCollection,summarizeCollectionPlan,collectToDirectory} from './fetch-amap-bicycle.mjs';
const body={status:'1',infocode:'10000',route:{paths:[{distance:'1112',steps:[{polyline:'0,0;0.01,0'}]}]}};
const fixture=()=>({legs:[0,1,2].map(i=>({start:[0,i*.01],end:[0,(i+1)*.01]})),navigationGroups:[{firstLeg:1,lastLeg:1,name:'Start',reason:'Synthetic'},{firstLeg:2,lastLeg:3,name:'Combined',reason:'Synthetic'}]});
const cli=fileURLToPath(new URL('./fetch-amap-bicycle.mjs',import.meta.url));
async function input(m){const root=await fs.mkdtemp(path.join(os.tmpdir(),'cycling-preflight-')),file=path.join(root,'manifest.json');await fs.writeFile(file,JSON.stringify(m));return {root,file};}
function run(args){const env={...process.env};delete env.AMAP_WEB_SERVICE_KEY;delete env.NODE_OPTIONS;delete env.NODE_PATH;return spawnSync(process.execPath,[cli,...args],{encoding:'utf8',env,timeout:10000,windowsHide:true});}

test('whole batch includes component, nonsingleton group and actual deletion queries',()=>{
 const m=fixture(),before=JSON.stringify(m),p=planCollection(m);
 assert.equal(p.requests.length,5);assert.deepEqual(p.requestCounts,{legs:3,navigationGroups:1,deletions:1});
 assert.equal(p.navigationTasks,2);assert.equal(p.candidateManualSwitches,1);assert.equal(p.reusedSingletonGroups,1);
 assert.deepEqual(p.requests.map(x=>[x.stage,x.index]),[['leg',1],['leg',2],['leg',3],['navigation-group',2],['merge-after',1]]);
 assert.deepEqual(p.requests.at(-1).start,m.legs[0].start);assert.deepEqual(p.requests.at(-1).end,m.legs[2].end);assert.equal(JSON.stringify(m),before);
});
test('without groups each component is a task; one component has no switch or deletion',()=>{
 const m=fixture();delete m.navigationGroups;let p=planCollection(m);assert.equal(p.requests.length,5);assert.equal(p.candidateManualSwitches,2);
 m.legs=m.legs.slice(0,1);p=planCollection(m);assert.equal(p.requests.length,1);assert.equal(p.candidateManualSwitches,0);
});
test('group explicit false overrides component mandatory true in plan and actual collection',async()=>{
 const m=fixture();m.legs[0].endMandatory=true;assert.equal(planCollection(m).requestCounts.deletions,0);
 m.navigationGroups[0].endMandatory=false;const p=planCollection(m);assert.equal(p.requestCounts.deletions,1);
 const {root}=await input(m),events=[];await collectToDirectory(m,'SYNTHETIC',path.join(root,'captures'),async()=>({ok:true,json:async()=>body}),{maxRequests:5});
 const files=(await fs.readdir(path.join(root,'captures'))).filter(x=>/^request-/.test(x)).sort();
 for(const file of files){const x=JSON.parse(await fs.readFile(path.join(root,'captures',file)));events.push([x.stage,x.index]);}
 assert.deepEqual(events,p.requests.map(x=>[x.stage,x.index]));
});
test('shape points, essential waypoints, cues and supplies do not create extra queries',()=>{
 const m=fixture();m.legs[1].referencePoints=[[0,.01],[0,.015],[0,.02]];m.legs[1].essentialWaypoints=[{name:'Synthetic entry',point:[0,.015]}];
 m.cues=[{kind:'key',point:[0,.015]}];m.supplies=[{point:[0,.02]}];m.turnCandidates=[{point:[0,.025]}];
 const summary=summarizeCollectionPlan(planCollection(m));assert.equal(summary.plannedRequests,5);assert.equal(summary.navigationTasks,2);
 const serialized=JSON.stringify(summary);for(const key of ['referencePoints','essentialWaypoints','supplies','turnCandidates','start','end','key=','restapi'])assert(!serialized.includes('"'+key+'"'));
});
test('invalid late endpoint is rejected before the first client call or directory creation',async()=>{
 const m=fixture();m.legs[2].end=[91,0];const {root}=await input(m),out=path.join(root,'must-not-exist');let calls=0;
 await assert.rejects(collectToDirectory(m,'SYNTHETIC',out,async()=>{calls++;return {ok:true,json:async()=>body}},{maxRequests:5}),/leg 3/);
 assert.equal(calls,0);await assert.rejects(fs.access(out),{code:'ENOENT'});
});
test('invalid groups and empty manifests fail locally',()=>{
 for(const m of [{},{legs:[]},{legs:[{start:[0,0],end:[0,.01]}],navigationGroups:[]},{...fixture(),navigationGroups:[{firstLeg:2,lastLeg:3,name:'Gap',reason:'Synthetic'}]}])assert.throws(()=>planCollection(m));
});
test('zero or insufficient budget rejects the entire batch before any request or output',async()=>{
 const m=fixture(),{root}=await input(m);let calls=0;
 for(const cap of [0,4]){const out=path.join(root,'cap-'+cap);assert.equal(planCollection(m,{maxRequests:cap}).withinBudget,false);
  await assert.rejects(collectToDirectory(m,'SYNTHETIC',out,async()=>{calls++;return {ok:true,json:async()=>body}},{maxRequests:cap}),/budget exceeded/);await assert.rejects(fs.access(out),{code:'ENOENT'});}
 assert.equal(calls,0);
});
test('missing or invalid collection cap rejects before any client call or output directory',async t=>{
 const cases=[['omitted'],['empty',{}],['undefined',{maxRequests:undefined}],
  ...[null,NaN,Infinity,-Infinity,-1,1.5,'5',Number.MAX_SAFE_INTEGER+1].map((maxRequests,i)=>['invalid-'+i,{maxRequests}])];
 for(const [name,options] of cases)await t.test(name,async()=>{
  const m=fixture(),{root}=await input(m),out=path.join(root,'must-not-exist');let calls=0;
  const request=async()=>{calls++;return {ok:true,json:async()=>body}};
  await assert.rejects(collectToDirectory(m,'SYNTHETIC',out,request,...(options===undefined?[]:[options])),/maxRequests.*non-negative safe integer/);
  assert.equal(calls,0);await assert.rejects(fs.access(out),{code:'ENOENT'});
 });
});
test('exact and larger budgets run planned count and save redacted local plan beside original captures',async t=>{
 for(const cap of [5,8,Number.MAX_SAFE_INTEGER])await t.test(String(cap),async()=>{
 const m=fixture(),{root}=await input(m),out=path.join(root,'captures');let calls=0;
 const report=await collectToDirectory(m,'SYNTHETIC',out,async()=>{calls++;return {ok:true,json:async()=>body}},{maxRequests:cap});
 assert.equal(calls,5);assert.equal(report.plannedRequests,5);assert.equal(report.attemptedRequests,5);assert.equal(report.automaticRetries,0);
 const saved=JSON.parse(await fs.readFile(path.join(out,'collection-plan.json')));assert.equal(saved.maxRequests,cap);assert.equal(saved.withinBudget,true);assert.equal(JSON.stringify(saved).includes('SYNTHETIC'),false);
 });
});
test('changing collection cap getter cannot turn an insufficient first value into an unlimited batch',async()=>{
 const m=fixture(),{root}=await input(m),out=path.join(root,'must-not-exist');let reads=0,calls=0;
 const options={get maxRequests(){return ++reads<=2?0:undefined}};
 await assert.rejects(collectToDirectory(m,'SYNTHETIC',out,async()=>{calls++;return {ok:true,json:async()=>body}},options),/budget exceeded/);
 assert.equal(reads,1);assert.equal(calls,0);await assert.rejects(fs.access(out),{code:'ENOENT'});
});
test('changing collection cap getter preserves its sufficient first value throughout planning and capture',async()=>{
 const m=fixture(),{root}=await input(m),out=path.join(root,'captures');let reads=0,calls=0;
 const options={get maxRequests(){return ++reads===1?5:undefined}};
 const report=await collectToDirectory(m,'SYNTHETIC',out,async()=>{calls++;return {ok:true,json:async()=>body}},options);
 assert.equal(reads,1);assert.equal(calls,5);assert.equal(report.plannedRequests,5);assert.equal(report.attemptedRequests,5);
 const saved=JSON.parse(await fs.readFile(path.join(out,'collection-plan.json')));assert.equal(saved.maxRequests,5);assert.equal(saved.withinBudget,true);
});
test('invalid numeric budget is not coerced into an unlimited cap',()=>{
 for(const maxRequests of [-1,NaN,Infinity,1.5,'5',null,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>planCollection(fixture(),{maxRequests}),/non-negative safe integer/);
});
test('mutating caller manifest during collection cannot expand the preflighted batch',async()=>{
 const m={legs:[{start:[0,0],end:[0,.01]}]}, {root}=await input(m);let calls=0;
 const r=await collectToDirectory(m,'SYNTHETIC',path.join(root,'captures'),async()=>{calls++;if(calls===1)m.legs.push({start:[0,.01],end:[0,.02]});return {ok:true,json:async()=>body}},{maxRequests:1});
 assert.equal(m.legs.length,2);assert.equal(calls,1);assert.equal(r.plannedRequests,1);assert.equal(r.attemptedRequests,1);
 const saved=JSON.parse(await fs.readFile(path.join(root,'captures/manifest-with-responses.json')));assert.equal(saved.legs.length,1);
});
test('dry run CLI works without Key, acknowledgement or output directory and emits no coordinates',async()=>{
 const m=fixture();m.legs[0].start=[12.345678,65.432109];const {root,file}=await input(m),before=await fs.readFile(file),r=run(['--manifest',file,'--dry-run']);
 assert.equal(r.status,0,r.stderr);const p=JSON.parse(r.stdout);assert.equal(p.plannedRequests,5);assert.equal(p.withinBudget,null);assert.match(p.scope,/not authorization/);
 assert(!r.stdout.includes('12.345678'));assert(!r.stdout.includes('65.432109'));assert.deepEqual(await fs.readdir(root),['manifest.json']);assert.deepEqual(await fs.readFile(file),before);
});
test('dry run at zero budget reports count but exits blocked, never collecting',async()=>{
 const {root,file}=await input(fixture()),r=run(['--manifest',file,'--dry-run','--max-requests','0']);
 assert.equal(r.status,1);const p=JSON.parse(r.stdout);assert.equal(p.plannedRequests,5);assert.equal(p.withinBudget,false);assert.deepEqual(await fs.readdir(root),['manifest.json']);
});
test('live CLI requires explicit cap and refuses insufficient cap before Key access or output',async()=>{
 const {root,file}=await input(fixture()),out=path.join(root,'captures'),args=['--manifest',file,'--out-dir',out,'--send-segment-endpoints-to-amap'];
 let r=run(args);assert.equal(r.status,1);assert.match(r.stderr,/requires.*max-requests/);assert(!r.stderr.includes('not configured'));
 r=run([...args,'--max-requests','0']);assert.equal(r.status,1);assert.match(r.stderr,/budget exceeded/);assert(!r.stderr.includes('not configured'));await assert.rejects(fs.access(out),{code:'ENOENT'});
});
test('CLI rejects ambiguous, duplicate, invalid cap and mixed dry/live options locally',async()=>{
 const {root,file}=await input(fixture());
 for(const extra of [['--dry-run','--dry-run'],['--dry-run','--send-segment-endpoints-to-amap'],['--dry-run','--out-dir','unused'],['--max-requests','NaN'],['--max-requests','-1'],['--max-requests','1.5'],['--unknown'],['--max-requests']]){
  const r=run(['--manifest',file,...extra]);assert.equal(r.status,1,extra.join(' '));assert(!r.stderr.includes('not configured'));}
 assert.deepEqual(await fs.readdir(root),['manifest.json']);
});
test('help is read only and describes local versus authorized modes',()=>{
 const r=run(['--help']);assert.equal(r.status,0);assert.match(r.stdout,/Local only/);assert.match(r.stdout,/max-requests/);assert(!r.stdout.includes('AMAP_WEB_SERVICE_KEY='));
});
