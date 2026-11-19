import test from 'node:test';
import assert from 'node:assert/strict';
import {assemble} from './assemble-amap-map.mjs';
import {restoreCaptureDates} from './import-api-evidence.mjs';
const response=p=>({status:'1',infocode:'10000',route:{paths:[{distance:String((p.length-1)*1112),steps:[{polyline:p.map(q=>q[1]+','+q[0]).join(';')}]}]}});
function fixture(){
 const p=[[0,0],[0,.01],[0,.02],[0,.03]],r=p.slice(1).map((q,i)=>response([p[i],q]));
 const m={actualStart:p[0],actualEnd:p[3],queriedAt:'2026-10-15',legs:p.slice(1).map((q,i)=>({type:i===0?'outbound':i===1?'main':'return',name:'Synthetic '+i,reason:'Synthetic date provenance only',start:p[i],end:q,queriedAt:i===0?'2026-10-12':'2026-10-13',responseFile:'leg-0'+(i+1)+'.json',...(i===1?{referencePoints:[p[i],q]}:{}),...(i<2?{endMandatory:true,mandatoryKind:i===0?'route_join':'route_leave',mandatoryEvidence:'Synthetic role boundary; not actual road proof'}:{})})),review:{routeAndRoadsChecked:true,navDeletionChecked:true,accessChecked:true,checkedAt:'2026-10-15',evidence:'Synthetic date test only, not actual road approval'}};
 return {m,r,p};
}
test('mixed captures retain each query date and do not adopt the regeneration date',()=>{
 const {m,r}=fixture(),a=assemble(m,r);assert.equal(a.report.status,'complete');
 assert.deepEqual(a.data.routeParts.map(p=>p.distanceEvidence.queriedAt),['2026-10-12','2026-10-13','2026-10-13']);
 assert.deepEqual(a.data.queryDates,['2026-10-12','2026-10-13']);assert.match(a.data.distanceBasis,/2026-10-12、2026-10-13/);
 assert.ok(!a.data.distanceBasis.includes('2026-10-15'));assert.equal(a.data.navSegments[0].distanceEvidence.queriedAt,'2026-10-12');
});
test('fully dated legs assemble without artificial global fallback; missing individual date still blocks',()=>{
 const {m,r}=fixture();delete m.queriedAt;let a=assemble(m,r);assert.equal(a.report.status,'complete');assert.deepEqual(a.data.queryDates,['2026-10-12','2026-10-13']);assert.ok(!a.report.errors.some(x=>x.includes('AMap query date')));
 delete m.legs[0].queriedAt;a=assemble(m,r);assert.equal(a.report.status,'draft');assert.match(a.report.errors.join(' '),/Leg 1 query date missing or invalid/);
});
test('independent group dates and Shanghai midnight are not replaced by component dates',()=>{
 const {m,r,p}=fixture();m.navigationGroups=[{firstLeg:1,lastLeg:1,name:'Single reused',reason:'Synthetic singleton'},{firstLeg:2,lastLeg:3,name:'New combined',reason:'Synthetic new query',queriedAt:'2026-10-13T17:05:00Z'}];
 const a=assemble(m,r,[],[r[0],response(p.slice(1))]);assert.equal(a.report.status,'complete');
 assert.deepEqual(a.data.queryDates,['2026-10-12','2026-10-14']);assert.deepEqual(a.data.compositionQueryDates,['2026-10-12','2026-10-13']);
 assert.equal(a.data.navigationRouteParts[1].distanceEvidence.queriedAt,'2026-10-13T17:05:00Z');
});
test('invalid explicit record dates cannot be hidden behind a valid global fallback',()=>{
 for(const date of ['not-a-date','2026-02-30',null]){const {m,r}=fixture();m.legs[0].queriedAt=date;const a=assemble(m,r);
 assert.equal(a.report.status,'draft');assert.equal(a.data.totalKm,null);assert.match(a.report.errors.join(' '),/Leg 1 query date missing or invalid/);}
});
test('capture import restores only matching record dates, not old approval or mismatched filenames',()=>{
 const m={queriedAt:'2026-10-15',legs:[{responseFile:'captures/leg-01.json'},{responseFile:'captures/leg-02.json'}],review:{routeAndRoadsChecked:false}};
 restoreCaptureDates(m,{legs:[{responseFile:'leg-01.json',queriedAt:'2026-10-12'},{responseFile:'foreign.json',queriedAt:'2026-10-13'}],review:{routeAndRoadsChecked:true}});
 assert.equal(m.legs[0].queriedAt,'2026-10-12');assert.equal(m.legs[1].queriedAt,undefined);assert.equal(m.review.routeAndRoadsChecked,false);
 assert.throws(()=>restoreCaptureDates(m,{legs:[{responseFile:'leg-01.json',queriedAt:'bad'}]}),/Invalid original capture query date/);
 assert.throws(()=>restoreCaptureDates(m,{legs:[{responseFile:'leg-01.json',queriedAt:'2026-10-12'},{responseFile:'leg-01.json',queriedAt:'2026-10-13'}]}),/Ambiguous/);
});

test('deletion query dates are retained and explicit unknown dates cannot approve a boundary',()=>{
 const {m,r,p}=fixture();m.legs[0].endMandatory=false;m.removalTests=[{boundaryAfterLeg:1,queriedAt:'2026-10-14'}];
 const merged=response([p[0],[.01,.005],p[2]]);
 const valid=assemble(m,r,[merged]);assert.equal(valid.report.status,'complete');
 assert.equal(valid.report.removalReports[0].queriedAt,'2026-10-14');assert.equal(valid.report.removalReports[0].removable,false);
 m.removalTests[0].queriedAt=null;const bad=assemble(m,r,[merged]);assert.equal(bad.report.status,'draft');
 assert.equal(bad.data.totalKm,null);assert.match(bad.report.errors.join(' '),/Deletion test after leg 1 query date missing or invalid/);
});
