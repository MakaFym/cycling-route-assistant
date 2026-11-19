import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileNavigationUri,parseVisibleMobileRide} from './capture-amap-mobile.mjs';
const fixture=()=>({mapUrl:'https://m.amap.com/navigation/ridemap/saddr=0,0&daddr=.01,0',
  detailUrl:'https://m.amap.com/navigation/ridedetail/saddr=0,0&daddr=.01,0',title:'骑车从模拟起点到模拟终点 - 高德地图',
  summaryLabel:'50分钟10公里',steps:['骑行17米左转','沿模拟道路骑行3769米左转']});
test('mobile URI explicitly selects ride without forcing native app launch',()=>{
  const u=mobileNavigationUri({start:[0,0],end:[0,.01],startName:'模拟起点',endName:'模拟终点'});
  assert.equal(u.hostname,'uri.amap.com');assert.equal(u.searchParams.get('mode'),'ride');
  assert.equal(u.searchParams.get('callnative'),'0');assert.equal(u.searchParams.has('key'),false);
  assert.throws(()=>mobileNavigationUri({start:[999,0],end:[0,0]}),/valid/);
});
test('visible mobile evidence preserves precision and stays unaccepted without geometry',()=>{
  const r=parseVisibleMobileRide(fixture());
  assert.equal(r.displayedDistanceKm,10);assert.equal(r.displayedDecimals,0);
  assert.equal(r.visibleStepSumMetres,3786);assert.equal(r.roundingRuleKnown,false);
  assert.equal(r.fixedCorridorVerified,false);assert.equal(r.usableTotalKm,null);
  const other=fixture();other.summaryLabel='1小时19分钟16.6公里';
  assert.equal(parseVisibleMobileRide(other).displayedMinutes,79);
  assert.equal(parseVisibleMobileRide(other).displayedDecimals,1);
});
test('a car fallback, scale label, foreign host or missing steps cannot count as cycling evidence',()=>{
  const car=fixture();car.mapUrl=car.mapUrl.replace('ridemap','carmap');assert.throws(()=>parseVisibleMobileRide(car),/confirmed/);
  const scale=fixture();scale.summaryLabel='2公里';assert.throws(()=>parseVisibleMobileRide(scale),/summary/);
  const foreign=fixture();foreign.mapUrl=foreign.mapUrl.replace('m.amap.com','example.com');assert.throws(()=>parseVisibleMobileRide(foreign),/confirmed/);
  const noSteps=fixture();noSteps.steps=[];assert.throws(()=>parseVisibleMobileRide(noSteps),/steps/);
});
