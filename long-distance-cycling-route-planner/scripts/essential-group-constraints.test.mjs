import test from 'node:test';import assert from 'node:assert/strict';import {assemble} from './assemble-amap-map.mjs';
const response=(points,distance)=>({status:'1',infocode:'10000',route:{paths:[{distance:String(distance),steps:[{polyline:points.map(p=>p[1]+','+p[0]).join(';')}]}]}});
function fixture(){
 const a=[0,0],bridge=[.0012,.01],b=[0,.02],points=[a,bridge,b],legs=points.slice(1).map((q,i)=>({type:'main',name:'SYNTHETIC part '+i,start:points[i],end:q,reason:'Synthetic route test only',referencePoints:[points[i],q],...(i===0?{essentialWaypoints:[{name:'SYNTHETIC required bridge entrance',point:bridge}]}:{})}));
 return {m:{actualStart:a,actualEnd:b,queriedAt:'2026-10-10',legs,review:{routeAndRoadsChecked:true,navDeletionChecked:true,accessChecked:true,checkedAt:'2026-10-10',evidence:'SYNTHETIC attestation solely for software branches; not road approval'}},r:[response([a,bridge],1112),response([bridge,b],1112)],valid:response(points,2224),shortcut:response([a,b],2224)};
}
test('merged group must preserve component essential entrances even when its footprint is within tolerance',()=>{
 const {m,r,valid,shortcut}=fixture();m.navigationGroups=[{firstLeg:1,lastLeg:2,name:'SYNTHETIC grouped ride',reason:'Synthetic low-switch test'}];
 const bad=assemble(m,r,[],[shortcut]);assert.equal(bad.report.status,'draft');assert.equal(bad.report.navigationGroupsAccepted,false);assert.equal(bad.data.totalKm,null);assert.match(bad.report.errors.join(' '),/Navigation group 1 misses ordered essential waypoint/);
 const good=assemble(m,r,[],[valid]);assert.equal(good.report.status,'complete');assert.equal(good.report.navigationGroupsAccepted,true);assert.equal(good.data.navSegments.length,1);
});
test('deletion cannot force a merge bypassing an entrance; a merge preserving it is still preferred',()=>{
 const {m,r,valid,shortcut}=fixture();m.removalTests=[{boundaryAfterLeg:1}];
 const keep=assemble(m,r,[shortcut]);assert.equal(keep.report.status,'complete');assert.equal(keep.report.removalReports[0].removable,false);assert.equal(keep.report.removalReports[0].essentialWaypointsPreserved,false);assert.match(keep.report.removalReports[0].essentialWaypointIssues.join(' '),/required bridge entrance/);assert.equal(keep.data.navSegments.length,2);
 const merge=assemble(m,r,[valid]);assert.equal(merge.report.status,'draft');assert.equal(merge.report.removalReports[0].removable,true);assert.equal(merge.report.removalReports[0].essentialWaypointsPreserved,true);assert.match(merge.report.errors.join(' '),/removable; merge/);
});
