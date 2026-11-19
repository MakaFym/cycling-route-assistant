import test from 'node:test';
import assert from 'node:assert/strict';
import {assemble} from './assemble-amap-map.mjs';
const original=[[0,0],[0,.01],[.01,.01],[.01,0]],line=[original[2],original[3],original[0],original[1]];
const response={status:'1',infocode:'10000',route:{paths:[{distance:'3336',steps:[{polyline:line.map(p=>p[1]+','+p[0]).join(';')}]}]}};
function fixture(){return {actualStart:line[0],actualEnd:line.at(-1),queriedAt:'2026-10-12',originalGpx:{points:original},legs:[{type:'main',name:'Synthetic gap',reason:'Synthetic gap comparison',start:line[0],end:line.at(-1),referenceSource:'original-gpx',referencePoints:line,alignmentReview:{checked:true,checkedAt:'2026-10-12',outcome:'accepted-local-reroute',evidence:'Synthetic only; never real road proof'}}],review:{routeAndRoadsChecked:true,navDeletionChecked:true,accessChecked:true,checkedAt:'2026-10-12',evidence:'Synthetic only; not actual road/access evidence'}}}
test('a flat original-GPX wrap cannot hide a fabricated tail/start chord behind review flags',()=>{
 const r=assemble(fixture(),[response]);assert.equal(r.report.status,'draft');assert.match(r.report.errors.join(' '),/tail\/start gap/);
});
test('valid contiguous references with repeated coordinates do not look like tail/start chords',()=>{
 const a=[0,0],b=[0,.01],c=[.01,.01],d=[0,.02],original=[a,b,c,b,d],line=[a,b,c];
 const m=fixture();m.originalGpx={points:original};m.actualStart=a;m.actualEnd=c;
 Object.assign(m.legs[0],{start:a,end:c,referencePoints:line});
 const raw={status:'1',infocode:'10000',route:{paths:[{distance:'2224',steps:[{polyline:line.map(p=>p[1]+','+p[0]).join(';')}]}]}};
 const result=assemble(m,[raw]);assert.equal(result.report.status,'complete');
});
test('disconnected spans cannot be concatenated in the comparison reference',()=>{
 const m=fixture();m.legs[0].referenceSpans=[{points:line.slice(0,2)},{points:line.slice(2)}];const r=assemble(m,[response]);assert.equal(r.report.status,'draft');assert.match(r.report.errors.join(' '),/concatenate/);
});
test('a deliberately partial span is labelled, not silently certified as full coverage',()=>{
 const m=fixture();m.legs[0].referenceSpans=[{points:line.slice(0,2)},{points:line.slice(2)}];m.legs[0].referencePoints=line.slice(0,2);m.legs[0].referenceScope='partial-original-span';
 const r=assemble(m,[response]);assert.equal(r.report.fidelityReports[0].referenceSpanCount,2);assert.equal(r.report.fidelityReports[0].comparisonScope,'partial-original-span');assert.match(r.data.note,/部分范围比较/);assert.deepEqual(r.data.originalGpx.points,original);
});

test('stale reference span metadata is rejected independently of a real tail/start concatenation',()=>{
 const m=fixture();m.legs[0].referencePoints=line.slice(0,2);m.legs[0].referenceScope='partial-original-span';
 m.legs[0].referenceSpans=[{points:line.slice(1,3)},{points:line.slice(2)}];
 const bad=assemble(m,[response]);assert.equal(bad.report.status,'draft');assert.match(bad.report.errors.join(' '),/stale span metadata/);
 assert.equal(bad.report.fidelityReports.length,0);assert.deepEqual(bad.data.originalGpx.points,original);
 m.legs[0].referenceSpans=[{points:line.slice(0,2)},{points:line.slice(2)}];
 const corrected=assemble(m,[response]);assert.equal(corrected.report.fidelityReports[0].referenceSpanCount,2);
 assert.equal(corrected.report.fidelityReports[0].comparisonScope,'partial-original-span');
});
