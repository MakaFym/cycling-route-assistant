import test from 'node:test';
import assert from 'node:assert/strict';
import {assemble} from './assemble-amap-map.mjs';
const response=(points,distance)=>({status:'1',infocode:'10000',route:{paths:[{distance:String(distance),steps:[{polyline:points.map(p=>p[1]+','+p[0]).join(';')}]}]}});
function fixture(){
 const p=[[0,0],[0,.01],[0,.02],[0,.03]],r=p.slice(0,-1).map((x,i)=>response([x,p[i+1]],1112));
 const m={actualStart:p[0],actualEnd:p[3],queriedAt:'2026-10-12',review:{routeAndRoadsChecked:true,navDeletionChecked:true,accessChecked:true,checkedAt:'2026-10-12',evidence:'Synthetic evidence only; not actual cycling approval'},legs:p.slice(0,-1).map((x,i)=>({type:i===0?'outbound':i===1?'main':'return',name:'Component '+i,start:x,end:p[i+1],reason:'Synthetic role',...(i===1?{referencePoints:[x,p[i+1]]}:{})})),navigationGroups:[{firstLeg:1,lastLeg:1,name:'Go to join',reason:'Synthetic join',responseFile:'one.json'},{firstLeg:2,lastLeg:3,name:'Main then return',reason:'No manual switch at component boundary',responseFile:'two.json'}]};
 m.legs[0].endMandatory=true;m.legs[0].mandatoryKind='route_join';m.legs[0].mandatoryEvidence='Synthetic actual planned join, not real evidence';
 return {m,r,g:[r[0],response(p.slice(1),2224)],p};
}
test('one navigation segment can span main and return without mislabelling composition or adding a switch',()=>{
 const {m,r,g}=fixture(),x=assemble(m,r,[],g);assert.equal(x.report.status,'complete');assert.equal(x.data.routeParts.length,3);assert.equal(x.data.navSegments.length,2);assert.equal(x.data.routeParts[1].type,'main');assert.equal(x.data.routeParts[2].type,'return');assert.equal(x.report.removalReports[1].manualSwitchRequired,false);assert.equal(x.data.totalKm,3.336);
});
test('navigation group mandatory boundary is honored, and explicit false overrides the component marker',()=>{
 const {m,r,g}=fixture();delete m.legs[0].endMandatory;delete m.legs[0].mandatoryKind;delete m.legs[0].mandatoryEvidence;
 Object.assign(m.navigationGroups[0],{endMandatory:true,mandatoryKind:'planned_stop',mandatoryEvidence:'Synthetic scheduled rest at this navigation group boundary only'});
 assert.equal(assemble(m,r,[],g).report.status,'complete');
 m.navigationGroups[0].mandatoryEvidence='';assert.equal(assemble(m,r,[],g).report.status,'draft');
 m.legs[0].endMandatory=true;m.navigationGroups[0].endMandatory=false;
 assert.match(assemble(m,r,[],g).report.errors.join(' '),/Missing AMap deletion/);
});
test('missing responses, skipped components and a shortcut group cannot enable navigation',()=>{
 const {m,r,g,p}=fixture();assert.equal(assemble(m,r,[],[]).report.status,'draft');
 m.navigationGroups[1].firstLeg=3;assert.equal(assemble(m,r,[],g).report.status,'draft');m.navigationGroups[1].firstLeg=2;
 assert.equal(assemble(m,r,[],[g[0],response([p[1],[.01,.02],p[3]],2224)]).report.status,'draft');
});
test('independent query metre differences are disclosed, never silently redistributed',()=>{
 const {m,r,g,p}=fixture();let x=assemble(m,r,[],[g[0],response(p.slice(1),2225)]);assert.equal(x.report.status,'complete');assert.equal(x.data.compositionTotalKm,3.336);assert.equal(x.data.totalKm,3.337);assert.equal(x.data.navigationTotalKm,3.337);assert.equal(x.data.compositionDifferenceKm,.001);assert.match(x.data.note,/1米/);
 x=assemble(m,r,[],[g[0],response(p.slice(1),2245)]);assert.equal(x.report.status,'draft');assert.match(x.report.errors.join(' '),/10 m/);
});
test('the displayed and projected navigation route is the original group geometry, not the subtly different component queries',()=>{
 const {m,r,g,p}=fixture(),actual=[p[1],[.0005,.015],[.0005,.025],p[3]],x=assemble(m,r,[],[g[0],response(actual,2224)]);
 assert.equal(x.report.status,'complete');assert.deepEqual(x.data.navigationRouteParts[1].points,actual);assert.equal(x.data.navigationRouteParts[1].type,'combined');assert.deepEqual(x.data.routeParts[1].points,[p[1],p[2]]);assert.notDeepEqual(x.data.navigationRouteParts[1].points,x.data.routeParts[1].points);
});
test('an exact ten-metre independent-query difference is not spuriously rejected by floating point',()=>{
 const {m,r,g,p}=fixture(),x=assemble(m,r,[],[g[0],response(p.slice(1),2234)]);assert.equal(x.report.status,'complete');assert.equal(x.data.compositionDifferenceKm,.01);
});

test('a rejected group falls back to sourced components and cannot hide real fallback navigation boundaries',()=>{
 const {m,r,g,p}=fixture(),x=assemble(m,r,[],[g[0],response([p[1],[.01,.02],p[3]],2224)]);
 assert.equal(x.report.status,'draft');assert.equal(x.report.navigationGroupsAccepted,false);
 assert.equal(x.data.navigationRouteParts,undefined);
 assert.deepEqual(x.data.routeParts.map(v=>v.type),['outbound','main','return']);
 assert.ok(x.data.routeParts.every(v=>v.distanceEvidence.type==='amap-api-v5'));
 assert.equal(x.data.navSegments.length,3);
 assert.match(x.report.errors.join(' '),/Missing AMap deletion test after leg 2/);
 assert.ok(!x.report.removalReports.some(v=>v.internalCompositionBoundary));
 assert.match(x.data.note,/组合导航未通过/);assert.equal(x.data.totalKm,null);
});
