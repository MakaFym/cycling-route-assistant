import test from 'node:test';
import assert from 'node:assert/strict';
import {importEvidence,importGroups} from './import-api-evidence.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const record=(a,b)=>({status:'1',infocode:'10000',route:{origin:a[1]+','+a[0],destination:b[1]+','+b[0],paths:[{distance:'2000',steps:[{road_name:'Synthetic road',polyline:a[1]+','+a[0]+';'+b[1]+','+b[0]}]}]}});
const options=(a,b)=>({start:a,end:b,topology:'open',direction:'forward',queriedAt:'2026-10-12'});
test('complete per-leg original dates require no artificial global date and preserve mixed batches',()=>{
 const p=[[0,0],[0,.01],[0,.02]],raw=[record(p[0],p[1]),record(p[1],p[2])],o={...options(p[0],p[2]),queriedAt:undefined,legQueryDates:['2026-10-10','2026-10-12']},m=importEvidence(p,raw,o);
 assert.equal(m.queriedAt,undefined);assert.deepEqual(m.legs.map(x=>x.queriedAt),o.legQueryDates);assert.equal(m.review.routeAndRoadsChecked,false);
 assert.throws(()=>importEvidence(p,raw,{...o,legQueryDates:['2026-10-10']}),/Every original leg query date/);
 assert.throws(()=>importEvidence(p,raw,{...o,legQueryDates:['2026-10-10',null]}),/Every original leg query date/);
 assert.throws(()=>importEvidence(p,raw,{...o,queriedAt:'today'}),/date required/);
});
test('CLI imports fully dated raw captures without global date; partial or unknown arguments fail safely',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'cycling-dated-import-')),source=path.join(root,'raw'),gpx=path.join(root,'route.gpx'),p=[[0,0],[0,.01],[0,.02]];await fs.mkdir(source);
 await fs.writeFile(gpx,'<gpx><trk><trkseg>'+p.map(x=>`<trkpt lat="${x[0]}" lon="${x[1]}"/>`).join('')+'</trkseg></trk></gpx>');
 for(let i=0;i<2;i++)await fs.writeFile(path.join(source,'leg-0'+(i+1)+'.json'),JSON.stringify(record(p[i],p[i+1])));
 const dates={legs:[{responseFile:'leg-01.json',queriedAt:'2026-10-10'},{responseFile:'leg-02.json',queriedAt:'2026-10-12'}]},dateFile=path.join(source,'manifest-with-responses.json');await fs.writeFile(dateFile,JSON.stringify(dates));
 const script=fileURLToPath(new URL('./import-api-evidence.mjs',import.meta.url)),base=['--gpx',gpx,'--responses',source,'--start','0,0','--end','0,0.02','--topology','open','--direction','forward'],run=args=>spawnSync(process.execPath,[script,...args],{encoding:'utf8',windowsHide:true});
 let x=run([...base,'--out-dir',path.join(root,'good')]);assert.equal(x.status,0,x.stderr);const m=JSON.parse(await fs.readFile(path.join(root,'good/manifest.json'),'utf8'));assert.equal(m.queriedAt,undefined);assert.deepEqual(m.legs.map(x=>x.queriedAt),dates.legs.map(x=>x.queriedAt));
 assert.equal(run(['--help']).status,0);assert.equal(run([...base,'--out-dir',path.join(root,'unknown'),'--fake','value']).status,1);
 dates.legs.pop();await fs.writeFile(dateFile,JSON.stringify(dates));x=run([...base,'--out-dir',path.join(root,'missing')]);assert.equal(x.status,1);assert.match(x.stderr,/Every leg needs its original query date/);await assert.rejects(fs.stat(path.join(root,'missing')),{code:'ENOENT'});
});
test('raw response import uses actual start, defaults and preserves the complete GPX without review approval',()=>{
 const p=[[0,0],[0,.01],[0,.02]],a=[0,-.01];const m=importEvidence(p,[record(a,p[0]),record(p[0],p[2]),record(p[2],a)],{...options(a,a),topology:'loop'});
 assert.equal(m.days,1);assert.equal(m.alignmentMode,'gpx-guided');assert.deepEqual(m.originalGpx.points,p);assert.deepEqual(m.legs.map(x=>x.type),['outbound','main','return']);assert.equal(m.review.accessChecked,false);assert.equal(m.cues[0].kind,'safety');assert.equal(m.supplies.length,0);
});
test('wrap-around keeps original spans separate and never invents a GPX connector',()=>{
 const p=[[0,0],[0,.01],[.01,.01],[.01,0]],a=p[2],b=p[1];const m=importEvidence(p,[record(a,b)],{...options(a,b),topology:'loop'});
 assert.equal(m.legs[0].referenceSpans.length,2);assert.equal(m.legs[0].referencePoints.length,2);assert.ok(m.legs[0].referenceGapMetres>1000);assert.deepEqual(m.originalGpx.points,p);
});
test('open route wrong direction and captures for another start are rejected',()=>{
 const p=[[0,0],[0,.01],[0,.02]];assert.throws(()=>importEvidence(p,[record(p[2],p[0])],options(p[2],p[0])),/order/);
 assert.throws(()=>importEvidence(p,[record(p[0],p[2])],options([1,1],p[2])),/actual start/);
});
test('direction, topology and date are explicit; reverse is not guessed',()=>{
 const p=[[0,0],[0,.01],[0,.02]];const m=importEvidence(p,[record(p[2],p[0])],{...options(p[2],p[0]),direction:'reverse'});assert.deepEqual(m.legs[0].referencePoints,[...p].reverse());assert.deepEqual(m.originalGpx.points,p);
 assert.throws(()=>importEvidence(p,[record(p[0],p[2])],{...options(p[0],p[2]),topology:undefined}),/topology/);
 assert.throws(()=>importEvidence(p,[record(p[0],p[2])],{...options(p[0],p[2]),queriedAt:'invalid'}),/date/);
});
test('raw merged captures reconstruct groups spanning separately sourced main and return parts',()=>{
 const p=[[0,0],[0,.01],[0,.02],[0,.03]],legs=p.slice(0,-1).map((start,i)=>({start,end:p[i+1]}));
 const g=importGroups(legs,[record(p[0],p[1]),record(p[1],p[3])]);assert.deepEqual(g.map(x=>[x.firstLeg,x.lastLeg]),[[1,1],[2,3]]);
 assert.throws(()=>importGroups(legs,[record(p[0],p[1])]),/cover/);
});
test('an earlier named road cannot impersonate an unnamed endpoint, and an open endpoint is not called the start',()=>{
 const p=[[0,0],[0,.01],[0,.02]],r=record(p[0],p[1]);r.route.paths[0].steps.push({polyline:'.01,0;.01,0'});
 const m=importEvidence(p,[r,record(p[1],p[2])],{...options(p[0],p[2]),startName:'Synthetic start'});
 assert.ok(!m.legs[0].endpointName.includes('Synthetic road'));assert.ok(!m.legs[1].endpointName.includes('Synthetic start'));
});
test('repeated endpoints are resolved by complete original geometry and order, not the first coordinate match',()=>{
 const b=[44.3,-78.6],c=[44.3,-78.58],d=[44.31,-78.58],p=[b,c,d,c,b],legs=p.slice(0,-1).map((start,i)=>({start,end:p[i+1]})),components=legs.map(x=>record(x.start,x.end));
 const group=record(b,c);group.route.paths[0].steps[0].polyline=[b,c,d,c].map(p=>p[1]+','+p[0]).join(';');
 const records=[group,record(c,b)];
 assert.throws(()=>importGroups(legs,records),/Ambiguous/);
 assert.deepEqual(importGroups(legs,records,components).map(x=>[x.firstLeg,x.lastLeg]),[[1,3],[4,4]]);
});
test('open GPX repeated vertices are resolved jointly in forward and reverse traversal',()=>{
 const a=[0,0],b=[0,.01],c=[.01,.01],d=[0,.02],p=[a,b,c,b,d];
 for(const direction of ['forward','reverse']){
  const ordered=direction==='forward'?p:[...p].reverse(),raw=ordered.slice(1).map((q,i)=>record(ordered[i],q));
  const m=importEvidence(p,raw,{...options(ordered[0],ordered.at(-1)),direction});
  assert.deepEqual(m.originalGpx.points,p);
  assert.deepEqual(m.legs.map(x=>x.referencePoints),ordered.slice(1).map((q,i)=>[ordered[i],q]));
 }
});
test('a repeated start matches complete API geometry, never a fixed last occurrence',()=>{
 const a=[0,0],b=[0,.01],c=[.01,.01],d=[0,.02],p=[a,b,c,b,d],r=record(b,d);
 r.route.paths[0].steps[0].polyline=[b,c,b,d].map(q=>q[1]+','+q[0]).join(';');
 const m=importEvidence(p,[r],options(b,d));assert.deepEqual(m.legs[0].referencePoints,[b,c,b,d]);
});
test('truly equal repeated GPX intervals are rejected rather than guessed',()=>{
 const a=[0,0],b=[0,.01],c=[.01,.01],p=[a,b,c,a,b];
 assert.throws(()=>importEvidence(p,[record(a,b)],options(a,b)),/Ambiguous repeated GPX/);
});
test('closed GPX head/tail duplicate is a loop alias, not an ambiguous empty span',()=>{
 const p=[[0,0],[0,.01],[.01,.01],[.01,0],[0,0]],r=record(p[0],p.at(-1));
 r.route.paths[0].steps[0].polyline=p.map(q=>q[1]+','+q[0]).join(';');
 const m=importEvidence(p,[r],{...options(p[0],p.at(-1)),topology:'loop'});
 assert.deepEqual(m.legs[0].referencePoints,p);
});
test('adjacent main captures cannot jump across a nonzero repeated-vertex interval',()=>{
 const a=[0,0],b=[0,.01],c=[.01,.01],d=[0,.02],p=[a,b,c,b,d];
 const m=importEvidence(p,[record(a,b),record(b,d)],options(a,d));
 const coverage=m.legs.flatMap((x,i)=>i?x.referencePoints.slice(1):x.referencePoints);
 assert.deepEqual(coverage,p,'The skipped interval must remain in one contiguous comparison, not silently disappear');
});
test('consecutive zero-length samples are aliases, not distinct road interpretations',()=>{
 const a=[0,0],b=[0,.01],c=[0,.02];
 for(const p of [[a,b,b,c],[a,b,b,b,c]]){
  const m=importEvidence(p,[record(a,b),record(b,c)],options(a,c));
  assert.deepEqual(m.originalGpx.points,p);assert.equal(m.legs.length,2);
 }
});
