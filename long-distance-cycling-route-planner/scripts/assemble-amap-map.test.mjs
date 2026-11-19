import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {assemble,parseAmapBicycleV5,renderMap} from './assemble-amap-map.mjs';

const response=(polyline,distance='1112')=>({
  status:'1',infocode:'10000',info:'OK',
  route:{paths:[{distance,steps:[{polyline}]}]}
});
test('disconnected API steps are rejected instead of inventing a road chord',()=>{
  const raw=response('0,0;0.005,0','2224');
  raw.route.paths[0].steps.push({polyline:'0.015,0;0.02,0'});
  assert.throws(()=>parseAmapBicycleV5(raw),/internal step geometry gap/);
  assert.equal(assemble(manifest(),[raw]).report.status,'draft');
  const contiguous=response('0,0;0.005,0');
  contiguous.route.paths[0].steps.push({polyline:'0.005,0;0.01,0'});
  assert.equal(parseAmapBicycleV5(contiguous).points.length,3);
});
test('ordered essential points must progress within a single sparse segment',()=>{
  const m=manifest();m.actualEnd=[0,.02];m.legs[0].end=m.actualEnd;m.legs[0].referencePoints=[[0,0],m.actualEnd];
  m.review={routeAndRoadsChecked:true,navDeletionChecked:true,accessChecked:true,checkedAt:'2026-10-10',evidence:'Synthetic test only, no real road approval'};
  m.legs[0].essentialWaypoints=[{name:'far',point:[0,.015]},{name:'near',point:[0,.005]}];
  const rejected=assemble(m,[response('0,0;0.02,0','2224')]);
  assert.equal(rejected.report.status,'draft');assert.match(rejected.report.errors.join(' '),/ordered essential waypoint/);
  m.legs[0].essentialWaypoints.reverse();
  assert.equal(assemble(m,[response('0,0;0.02,0','2224')]).report.status,'complete');
});
const manifest=()=>({
  title:'Synthetic route',alignmentMode:'strict',actualStart:[0,0],actualEnd:[0,.01],queriedAt:'2026-10-10',
  legs:[{type:'main',name:'Synthetic main',reason:'Fixed-route end',start:[0,0],end:[0,.01],
    referencePoints:[[0,0],[0,.01]]}]
});

function orderedFixture(reference,actual){
  const m=manifest();m.actualStart=reference[0];m.actualEnd=reference.at(-1);
  m.legs[0]={...m.legs[0],start:m.actualStart,end:m.actualEnd,referencePoints:reference};
  m.review={routeAndRoadsChecked:true,navDeletionChecked:true,accessChecked:true,checkedAt:'2026-10-11',
    evidence:'Synthetic diagnostic only; never genuine riding approval'};
  return assemble(m,[response(actual.map(p=>p[1]+','+p[0]).join(';'),'4450')]);
}

test('planning notes survive metadata writeback without removing draft guards or executing markup',async()=>{
  const {applyReviewMetadata}=await import('./apply-review-metadata.mjs');
  const note='SYNTHETIC_SAFETY_NOTE: stop before operating phone; time is assumed. <script>UNTRUSTED_TEXT</script>';
  const m=applyReviewMetadata(manifest(),{note}),{data,report}=assemble(m,[response('0,0;0.01,0')]);
  assert.ok(data.note.includes(note));assert.ok(data.note.includes('未完成'));
  assert.equal(report.status,'draft');assert.equal(data.totalKm,null);
  const template=await fs.readFile(new URL('../assets/map-shell.html',import.meta.url),'utf8');
  assert.ok(!(await renderMap(template,data)).includes('<script>UNTRUSTED_TEXT</script>'));
  assert.throws(()=>assemble({...m,note:{text:'invalid'}},[response('0,0;0.01,0')]),/note must be text/);
});
test('reversed closed loop cannot pass merely because its footprint matches',()=>{
  const line=[[0,0],[0,.01],[.01,.01],[.01,0],[0,0]];
  const result=orderedFixture(line,line.slice().reverse());
  assert.equal(result.report.status,'draft');
  assert.match(result.report.errors.join(' '),/order|direction/);
});
test('self-intersecting loops visited in the wrong order are rejected',()=>{
  const c=[0,0],a=[.01,-.01],b=[-.01,-.01],d=[.01,.01],e=[-.01,.01];
  const result=orderedFixture([c,a,b,c,d,e,c],[c,d,e,c,a,b,c]);
  assert.equal(result.report.status,'draft');
  assert.match(result.report.errors.join(' '),/order|direction/);
});
test('extra backtracking along the same road is rejected',()=>{
  const result=orderedFixture([[0,0],[0,.02]],[[0,0],[0,.01],[0,.005],[0,.02]]);
  assert.equal(result.report.status,'draft');
  assert.match(result.report.errors.join(' '),/order|direction/);
});
test('correct loop order and a different vertex density remain valid',()=>{
  const line=[[0,0],[0,.01],[.01,.01],[.01,0],[0,0]];
  const dense=line.flatMap((p,i)=>i?[[(p[0]+line[i-1][0])/2,(p[1]+line[i-1][1])/2],p]:[p]);
  assert.equal(orderedFixture(line,dense).report.status,'complete');
});

test('v5 bicycling response requires polyline and positive API distance',()=>{
  assert.equal(parseAmapBicycleV5(response('0,0;0.01,0')).distanceKm,1.112);
  assert.throws(()=>parseAmapBicycleV5(response('')),/polyline/);
  assert.throws(()=>parseAmapBicycleV5(response('0,0;0.01,0','0')),/path or distance/);
  assert.throws(()=>parseAmapBicycleV5({status:'0',info:'bad key'}),/failed/);
});

test('a response and matching line remain draft without independent road review',()=>{
  const result=assemble(manifest(),[response('0,0;0.01,0')]);
  assert.equal(result.report.status,'draft');
  assert.equal(result.data.totalKm,null);
  assert.equal(result.report.totalCandidateKm,1.112);
  assert.match(result.report.errors.join(' '),/review/);
});

test('a reviewed synthetic fixture exercises the complete output path',()=>{
  const m=manifest();
  m.review={routeAndRoadsChecked:true,navDeletionChecked:true,accessChecked:true,checkedAt:'2026-10-10',
    evidence:'Synthetic unit-test attestation only; never real riding evidence'};
  const result=assemble(m,[response('0,0;0.01,0')]);
  assert.equal(result.report.status,'complete');
  assert.equal(result.data.totalKm,1.112);
  assert.equal(result.data.navSegments.length,1);
  assert.deepEqual(result.data.navSegments[0].points,result.data.routeParts[0].points);
  assert.equal(result.data.routeParts[0].type,'main');
  assert.equal(result.data.routeParts[0].verified,true);
});

test('large route deviation and disconnected declared legs are rejected',()=>{
  const m=manifest();
  m.review={routeAndRoadsChecked:true,navDeletionChecked:true,accessChecked:true,checkedAt:'2026-10-10',
    evidence:'Synthetic unit-test attestation only; never real riding evidence'};
  const deviation=assemble(m,[response('0,0;0.005,0.01;0.01,0','3336')]);
  assert.equal(deviation.report.status,'draft');
  assert.match(deviation.report.errors.join(' '),/deviates/);
  assert.equal(deviation.data.referenceRoutes.length,1);
  assert.deepEqual(deviation.data.referenceRoutes[0].points,m.legs[0].referencePoints);
  assert.match(deviation.data.draftSummary,/固定参考线/);
  assert.notDeepEqual(deviation.data.routeParts[0].points,deviation.data.referenceRoutes[0].points);
  assert.equal(deviation.data.totalKm,null);
  const split=manifest();
  split.legs.push({type:'return',name:'Bad join',reason:'synthetic',start:[1,1],end:[0,.01]});
  const disconnected=assemble(split,[response('0,0;0.01,0'),response('1,1;0.01,0')]);
  assert.equal(disconnected.report.status,'draft');
  assert.match(disconnected.report.errors.join(' '),/gap/);
});

function twoLegs(){
  const m=manifest();
  m.legs=[
    {type:'main',name:'First',reason:'Synthetic branch',start:[0,0],end:[0,.005],referencePoints:[[0,0],[0,.005]]},
    {type:'main',name:'Second',reason:'Synthetic continuation',start:[0,.005],end:[0,.01],referencePoints:[[0,.005],[0,.01]]}
  ];
  m.review={routeAndRoadsChecked:true,navDeletionChecked:true,accessChecked:true,checkedAt:'2026-10-10',
    evidence:'Synthetic unit-test attestation only; never real riding evidence'};
  return m;
}
const twoResponses=[response('0,0;0.005,0','556'),response('0.005,0;0.01,0','556')];

test('redundant navigation boundary is rejected when a merged AMap path preserves corridor',()=>{
  const m=twoLegs();
  m.removalTests=[{boundaryAfterLeg:1,responseFile:'synthetic-merge.json'}];
  const result=assemble(m,twoResponses,[response('0,0;0.005,0;0.01,0','1112')]);
  assert.equal(result.report.status,'draft');
  assert.equal(result.data.totalKm,null);
  assert.equal(result.report.removalReports[0].removable,true);
  assert.match(result.report.errors.join(' '),/removable; merge/);
});

test('missing deletion test is rejected; materially different merged path retains boundary',()=>{
  const m=twoLegs();
  assert.match(assemble(m,twoResponses).report.errors.join(' '),/Missing AMap deletion test/);
  m.removalTests=[{boundaryAfterLeg:1,responseFile:'synthetic-merge.json'}];
  const result=assemble(m,twoResponses,[response('0,0;0.005,0.005;0.01,0','1800')]);
  assert.equal(result.report.status,'complete');
  assert.equal(result.report.removalReports[0].removable,false);
});

test('mandatory boundary needs a documented category and concrete evidence',()=>{
  const m=twoLegs();
  m.legs[0].endMandatory=true;
  assert.match(assemble(m,twoResponses).report.errors.join(' '),/lacks category and concrete evidence/);
  m.legs[0].mandatoryKind='planned_stop';
  m.legs[0].mandatoryEvidence='Synthetic scheduled rest stop at this boundary; the rider is already stopping.';
  const result=assemble(m,twoResponses);
  assert.equal(result.report.status,'complete');
  assert.equal(result.report.removalReports[0].requiredByPlan,true);
});

test('deletion test with unrelated endpoints cannot authorize retaining a boundary',()=>{
  const m=twoLegs();
  m.removalTests=[{boundaryAfterLeg:1,responseFile:'synthetic-merge.json'}];
  const result=assemble(m,twoResponses,[response('1,1;1.01,1','1112')]);
  assert.equal(result.report.status,'draft');
  assert.match(result.report.errors.join(' '),/merged route geometry endpoints/);
});

test('optional detours and turn candidates do not change the main route total',()=>{
  const m=manifest();
  m.review={routeAndRoadsChecked:true,navDeletionChecked:true,accessChecked:true,checkedAt:'2026-10-10',
    evidence:'Synthetic unit-test attestation only; never real riding evidence'};
  m.optionalRoutes=[{name:'Optional',distanceKm:.4,points:[[0,.003],[.002,.003]]}];
  m.turnCandidates=[{name:'Unverified turn',point:[0,.004]}];
  const result=assemble(m,[response('0,0;0.01,0')]);
  assert.equal(result.report.status,'complete');
  assert.equal(result.data.totalKm,1.112);
  assert.equal(result.data.optionalRoutes.length,1);
  assert.equal(result.data.turnCandidates.length,1);
  m.optionalRoutes.push({name:'Broken',points:[[999,999]]});
  const filtered=assemble(m,[response('0,0;0.01,0')]);
  assert.equal(filtered.data.optionalRoutes.length,1);
  assert.match(filtered.report.warnings.join(' '),/optionalRoutes item 2/);
});

test('generated HTML embeds pinned Leaflet and safely preserves user text',async()=>{
  const template=await fs.readFile(new URL('../assets/map-shell.html',import.meta.url),'utf8');
  const html=await renderMap(template,{title:'Synthetic $& <script>',routeParts:[],navSegments:[],status:'draft'});
  assert.ok(html.includes('BSD 2-Clause License'));
  assert.ok(html.includes('data:image/png;base64,'));
  assert.ok(!html.includes('<script src="https://unpkg.com/leaflet'));
  assert.ok(!html.includes('<link rel="stylesheet" href="https://unpkg.com/leaflet'));
  assert.ok(html.includes('Synthetic $& \\u003cscript>'));
  assert.ok(!html.includes('__ROUTE_DATA_JSON__'));
});
