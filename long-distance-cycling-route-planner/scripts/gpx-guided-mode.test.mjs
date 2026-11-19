import test from 'node:test';
import assert from 'node:assert/strict';
import {assemble,routeCoverage} from './assemble-amap-map.mjs';
const response=line=>({status:'1',infocode:'10000',info:'OK',route:{paths:[{distance:'2800',steps:[{polyline:line.map(p=>p[1]+','+p[0]).join(';')}]}]}});
const review={checked:true,checkedAt:'2026-10-12',outcome:'accepted-local-reroute',evidence:'Synthetic local parallel road reviewed, no required entrance skipped; never real riding approval'};
function fixture(){return {actualStart:[0,0],actualEnd:[0,.02],queriedAt:'2026-10-12',legs:[{type:'main',name:'Synthetic main',reason:'Synthetic corridor test',start:[0,0],end:[0,.02],referencePoints:[[0,0],[0,.02]],alignmentReview:review}],
 review:{routeAndRoadsChecked:true,navDeletionChecked:true,accessChecked:true,checkedAt:'2026-10-12',evidence:'Synthetic program-flow evidence; never genuine road review'}};}
const localDetour=[[0,0],[.003,.003],[.003,.017],[0,.02]];
test('guided mode accepts an explicitly reviewed local reroute without erasing GPX or treating its length as navigation distance',()=>{
 const m=fixture(),r=assemble(m,[response(localDetour)]);
 assert.equal(r.report.status,'complete');assert.equal(r.report.alignmentMode,'gpx-guided');
 assert.equal(r.data.totalKm,2.8);assert.deepEqual(r.data.referenceRoutes[0].points,m.legs[0].referencePoints);
 assert.equal(r.report.fidelityReports[0].differenceStatus,'reviewed-local-difference');
 assert.ok(r.report.warnings.length);assert.notDeepEqual(r.data.routeParts[0].points,r.data.referenceRoutes[0].points);
});
test('a significant local reroute without a concrete comparison review remains draft',()=>{
 const m=fixture();delete m.legs[0].alignmentReview;
 const r=assemble(m,[response(localDetour)]);assert.equal(r.report.status,'draft');assert.match(r.report.errors.join(' '),/alignment review/);
});
test('an explicit strict request still rejects the same local reroute',()=>{
 const m=fixture();m.alignmentMode='strict';const r=assemble(m,[response(localDetour)]);
 assert.equal(r.report.status,'draft');assert.match(r.report.errors.join(' '),/deviates|order/);
});
test('guided mode does not turn a same-footprint reversed loop into an acceptable local reroute',()=>{
 const m=fixture(),loop=[[0,0],[0,.01],[.01,.01],[.01,0],[0,0]];
 m.actualEnd=loop.at(-1);Object.assign(m.legs[0],{end:m.actualEnd,referencePoints:loop});
 const r=assemble(m,[response(loop.slice().reverse())]);assert.equal(r.report.status,'draft');assert.match(r.report.errors.join(' '),/order|direction/);
});
test('reviewed approximation cannot skip a declared essential road entrance',()=>{
 const m=fixture();m.legs[0].essentialWaypoints=[{name:'Required entrance',point:[.01,.01]}];
 const r=assemble(m,[response(localDetour)]);assert.equal(r.report.status,'draft');assert.match(r.report.errors.join(' '),/essential waypoint/);
});
test('unknown alignment policies cannot silently weaken route validation',()=>{
 const m=fixture();m.alignmentMode='ignore-everything';assert.throws(()=>assemble(m,[response(localDetour)]),/alignment mode/);
});
test('offset reversed loops, swapped lobes and substantial backtracking cannot be waived as lateral detours',()=>{
 const loop=[[0,0],[0,.01],[.01,.01],[.01,0],[0,0]];
 const lobes=[[0,0],[0,-.01],[.01,-.01],[.01,0],[0,0],[0,.01],[-.01,.01],[-.01,0],[0,0]];
 const cases=[[loop,loop.slice().reverse()],[lobes,[...lobes.slice(4),...lobes.slice(1,5)]],[[[0,0],[0,.01],[0,.02],[0,.03]],[[0,0],[0,.02],[0,.01],[0,.03]]]];
 for(const [reference,actual] of cases){
  const shifted=actual.map(p=>[p[0]+.0011,p[1]]),m=fixture();m.actualStart=shifted[0];m.actualEnd=shifted.at(-1);
  Object.assign(m.legs[0],{start:m.actualStart,end:m.actualEnd,referencePoints:reference});
  const r=assemble(m,[response(shifted)]);assert.equal(r.report.status,'draft');assert.match(r.report.errors.join(' '),/order|backtracking/);
 }
});
test('the complete original GPX is retained separately from clipped navigation references',()=>{
 const m=fixture();m.originalGpx={name:'Synthetic original GPX',points:[[0,0],[.004,.01],[0,.02]]};
 const r=assemble(m,[response(localDetour)]);assert.deepEqual(r.data.referenceRoutes[0].points,m.originalGpx.points);
 assert.deepEqual(r.data.originalGpx,m.originalGpx);assert.equal(r.data.totalKm,2.8);
});
test('a human local-reroute note cannot waive poor whole-route overlap on a long GPX',()=>{
 const reference=[[0,0],[0,.1]],actual=[[0,0],[.03,.02],[.03,.08],[0,.1]],m=fixture();
 m.actualEnd=reference.at(-1);Object.assign(m.legs[0],{end:m.actualEnd,referencePoints:reference});
 const r=assemble(m,[response(actual)]);
 assert.equal(r.report.status,'draft');assert.match(r.report.errors.join(' '),/overlap is insufficient/);
 assert.ok(r.report.mainRouteCoverage.referenceCoveredByAmap.within200mPct<70);
});
test('whole-route overlap report is direction-invariant and allows a bounded local detour',()=>{
 const reference=[[0,0],[0,.1]],actual=[[0,0],[0,.04],[.002,.045],[.002,.055],[0,.06],[0,.1]],m=fixture();
 m.actualEnd=reference.at(-1);Object.assign(m.legs[0],{end:m.actualEnd,referencePoints:reference});
 const r=assemble(m,[response(actual)]);
 assert.equal(r.report.status,'complete');assert.ok(r.report.mainRouteCoverage.referenceCoveredByAmap.within200mPct>=70);
 const forward=routeCoverage([reference],[actual]),reversed=routeCoverage([[...reference].reverse()],[[...actual].reverse()]);
 assert.deepEqual(reversed,forward);
});
test('a high aggregate overlap percentage cannot hide one long continuous shortcut',()=>{
 const reference=[[0,0],[0,.035],[0,.065],[0,.1]],actual=[[0,0],[0,.035],[.003,.035],[.003,.065],[0,.065],[0,.1]],m=fixture();
 m.actualEnd=reference.at(-1);Object.assign(m.legs[0],{end:m.actualEnd,referencePoints:reference});
 const r=assemble(m,[response(actual)]),c=r.report.mainRouteCoverage;
 assert.ok(c.referenceCoveredByAmap.within200mPct>=70,'aggregate coverage should appear acceptable for this regression fixture');
 assert.ok(c.referenceCoveredByAmap.longestBeyond200mKm>2);
 assert.equal(r.report.status,'draft');assert.match(r.report.warnings.join(' '),/continuous deviation/);
});
test('a review note cannot waive a route that leaves an endpoint and then returns before continuing',()=>{
 const reference=[[0,0],[0,.02]],actual=[[0,0],[0,-.002],[0,.02]],m=fixture();
 Object.assign(m.legs[0],{referencePoints:reference});
 const r=assemble(m,[response(actual)]);
 assert.equal(r.report.status,'draft');
 assert.match(r.report.errors.join(' '),/endpoint return|backtracking/);
 assert.equal(r.report.fidelityReports[0].endpointReturnAnomaly,true);
});
test('a review note cannot waive a severe nonordered corridor mismatch',()=>{
 const reference=[[0,0],[0,.02]],actual=[[0,0],[-.01,0],[-.01,.02],[0,.02]],m=fixture();
 Object.assign(m.legs[0],{referencePoints:reference});
 const r=assemble(m,[response(actual)]);
 assert.equal(r.report.status,'draft');
 assert.match(r.report.errors.join(' '),/severe nonordered corridor mismatch/);
});
test('diagnostic fracture-localization anchors cannot leak into a completed rider map',()=>{
 const m=fixture();m.legs[0].mandatoryKind='diagnostic_anchor';
 const r=assemble(m,[response([[0,0],[0,.02]])]);
 assert.equal(r.report.status,'draft');
 assert.match(r.report.errors.join(' '),/diagnostic-only anchor/);
});
test('an evidenced irreducible AMap graph gap is exported visibly and keeps the route in draft',()=>{
 const m=fixture();m.routeEngineGaps=[{name:'Synthetic 80 m path',start:[0,.009],end:[0,.01],points:[[0,.009],[0,.01]],referenceKm:.08,amapDistanceKm:2.2,checkedAt:'2026-10-20',evidence:'Exact cycling endpoint probe returned a 2.2 km detour for the 80 m fixed-route connection.',note:'Synthetic regression only'}];
 const r=assemble(m,[response([[0,0],[0,.02]])]);
 assert.equal(r.report.status,'draft');
 assert.equal(r.data.routeEngineGaps.length,1);
 assert.match(r.report.errors.join(' '),/AMap routing graph gap/);
 assert.match(r.data.draftSummary,/高德路网与GPX不一致/);
 assert.match(r.data.draftSummary,/Synthetic 80 m path/);
 assert.match(r.data.draftSummary,/需停车核对/);
});
