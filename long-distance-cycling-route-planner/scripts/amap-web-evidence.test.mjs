import test from 'node:test';
import assert from 'node:assert/strict';
import {parseWebRouteRecord,parseVisibleMobileRide} from './amap-web-evidence.mjs';
import {assemble} from './assemble-amap-map.mjs';
function fixture(){
  const leg={type:'main',name:'Synthetic web leg',reason:'Test only',start:[0,0],end:[0,.01],referencePoints:[[0,0],[0,.01]],evidenceType:'amap-mobile-web',
    geometryEvidence:{coordinateSystem:'WGS-84',source:'original-gpx',sourceEvidence:'Synthetic geometry fixture; not an actual GPX',points:[[0,0],[0,.01]],corridorReview:{checked:false}}};
  const record={status:'captured-not-accepted',queriedAt:'2026-10-11',requestedUri:'https://uri.amap.com/navigation?from=0,0,Start&to=.01,0,End&mode=ride&callnative=0',
    map:{url:'https://m.amap.com/navigation/ridemap/saddr=0,0,Start&daddr=.01,0,End'},
    details:{url:'https://m.amap.com/navigation/ridedetail/saddr=0,0,Start&daddr=.01,0,End',title:'骑车从模拟起点到模拟终点 - 高德地图',text:'Start\nEnd\n6分钟1.1公里',steps:['沿模拟道路骑行1112米到达目的地']},
    mapScreenshot:'synthetic-map.png',detailsScreenshot:'synthetic-details.png',parsed:{displayedDistanceKm:999}};
  const manifest={actualStart:leg.start,actualEnd:leg.end,queriedAt:'2026-10-11',legs:[leg],review:{routeAndRoadsChecked:true,navDeletionChecked:true,accessChecked:true,checkedAt:'2026-10-11',evidence:'Synthetic approval used only to test program flow'}};
  return {leg,record,manifest};
}
test('web capture enters assembly without pretending to be an API response and remains draft without corridor review',()=>{
  const {leg,record,manifest}=fixture();
  assert.equal(parseWebRouteRecord(record,leg).distanceKm,1.1);
  const result=assemble(manifest,[record]);
  assert.equal(result.report.status,'draft');assert.equal(result.data.totalKm,null);
  assert.equal(result.data.routeParts.length,1);
  assert.equal(result.data.routeParts[0].geometrySource,'original-gpx');
  assert.equal(result.data.routeParts[0].distanceEvidence.type,'amap-mobile-web');
  assert.equal(result.report.fidelityReports[0].geometrySource,'original-gpx');
  assert.equal(result.report.fidelityReports[0].comparedGeometryKm,result.report.fidelityReports[0].referenceGeometryKm);
  assert.ok(!('amapGeometryKm' in result.report.fidelityReports[0]));
  assert.match(result.report.errors.join(' '),/corridor review/);
  assert.match(result.data.note,/同道路走廊核对/);
  assert.match(result.data.note,/切换次数尚未确定/);
  assert.ok(!result.data.note.includes('Web distance'));
});
test('reviewed synthetic web fixture exercises separate provenance and approximate displayed total',()=>{
  const {leg,record,manifest}=fixture();
  leg.geometryEvidence.corridorReview={checked:true,checkedAt:'2026-10-11',evidence:'Synthetic corridor review only; never real route evidence'};
  const result=assemble(manifest,[record]);
  assert.equal(result.report.status,'complete');assert.equal(result.data.totalKm,1.1);
  assert.equal(result.data.totalApproximate,true);
  assert.match(result.data.distanceBasis,/近似值/);
  assert.match(result.data.routeParts[0].basis,/6分钟1.1公里/);
  assert.equal(record.status,'captured-not-accepted');
});
test('web navigation groups retain displayed precision even when component distances came from the API',()=>{
 const {leg,record,manifest}=fixture();leg.geometryEvidence.corridorReview={checked:true,checkedAt:'2026-10-11',evidence:'Synthetic-only documented geometry; not real web route evidence'};
 manifest.navigationGroups=[{firstLeg:1,lastLeg:1,name:'Synthetic web group',reason:'Synthetic source separation',evidenceType:'amap-mobile-web',geometryEvidence:leg.geometryEvidence}];
 manifest.legs=[{...leg,evidenceType:'amap-api-v5'}];delete manifest.legs[0].geometryEvidence;
 const api={status:'1',infocode:'10000',route:{paths:[{distance:'1092',steps:[{polyline:'0,0;.01,0'}]}]}};
 const r=assemble(manifest,[api],[],[record]);assert.equal(r.report.status,'complete');assert.equal(r.data.totalKm,1.1);assert.equal(r.data.compositionTotalKm,1.092);assert.equal(r.data.totalApproximate,true);assert.match(r.data.distanceBasis,/近似值/);assert.equal(r.data.navigationRouteParts[0].distanceEvidence.type,'amap-mobile-web');
});
test('web records must match the declared endpoints and cannot use stale parsed numbers',()=>{
  const {leg,record}=fixture();
  assert.equal(parseWebRouteRecord(record,leg).distanceKm,1.1);
  const wrong=structuredClone(record);wrong.requestedUri=wrong.requestedUri.replace('to=.01','to=.1');
  assert.throws(()=>parseWebRouteRecord(wrong,leg),/endpoints/);
  const redirect=structuredClone(record);redirect.map.url=redirect.map.url.replace('daddr=.01','daddr=.1');
  assert.throws(()=>parseWebRouteRecord(redirect,leg),/endpoints/);
});
test('missing sourced geometry, screenshots, cycling steps or HTTPS are rejected',()=>{
  const {leg,record}=fixture();
  const noGeometry=structuredClone(leg);delete noGeometry.geometryEvidence;
  assert.throws(()=>parseWebRouteRecord(record,noGeometry),/separately|separate/);
  const noShot=structuredClone(record);delete noShot.mapScreenshot;
  assert.throws(()=>parseWebRouteRecord(noShot,leg),/screenshots/);
  const noRide=structuredClone(record);noRide.details.steps=['从这里出发'];
  assert.throws(()=>parseWebRouteRecord(noRide,leg),/cycling distances/);
  const insecure=structuredClone(record);insecure.map.url=insecure.map.url.replace('https:','http:');
  assert.throws(()=>parseWebRouteRecord(insecure,leg),/confirmed/);
});
test('metre display retains kilometre precision without assuming a rounding interval',()=>{
  const {record}=fixture();
  const result=parseVisibleMobileRide({mapUrl:record.map.url,detailUrl:record.details.url,title:record.details.title,summaryLabel:'2分钟350米',steps:['骑行350米到达目的地']});
  assert.equal(result.displayedDistanceKm,.35);assert.equal(result.displayedDecimals,3);assert.equal(result.roundingRuleKnown,false);
});
test('an unreviewed local road candidate cannot be upgraded by only setting a review flag',()=>{
  const {leg,record,manifest}=fixture();
  leg.geometryEvidence.source='local-road-candidate';
  leg.geometryEvidence.corridorReview={checked:true,checkedAt:'2026-10-11',evidence:'Synthetic review string cannot promote candidate road geometry'};
  const result=assemble(manifest,[record]);
  assert.equal(result.report.status,'draft');assert.equal(result.data.totalKm,null);
  assert.match(result.report.errors.join(' '),/not certified road geometry/);
});
test('web geometry continuity errors do not claim GPX geometry came from AMap',()=>{
  const {leg,record,manifest}=fixture();
  const other=structuredClone(leg),second=structuredClone(record);
  other.start=[0,.03];other.end=[0,.04];other.referencePoints=other.geometryEvidence.points=[[0,.03],[0,.04]];
  second.requestedUri='https://uri.amap.com/navigation?from=.03,0,Start&to=.04,0,End&mode=ride&callnative=0';
  second.map.url='https://m.amap.com/navigation/ridemap/saddr=.03,0,Start&daddr=.04,0,End';
  second.details.url='https://m.amap.com/navigation/ridedetail/saddr=.03,0,Start&daddr=.04,0,End';
  manifest.legs.push(other);manifest.actualEnd=other.end;
  const errors=assemble(manifest,[record,second]).report.errors.join(' ');
  assert.match(errors,/Route geometry gap/);
  assert.ok(!errors.includes('AMap geometry gap'));
});
