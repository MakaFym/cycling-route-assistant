import test from 'node:test';
test('disconnected GPX segments are not silently concatenated; namespace prefixes are supported',()=>{
 assert.throws(()=>parseGpx('<gpx><trk><trkseg><trkpt lat="0" lon="0"/></trkseg><trkseg><trkpt lat="1" lon="1"/></trkseg></trk></gpx>'),/Multiple GPX/);
 assert.deepEqual(parseGpx('<g:gpx xmlns:g="http://www.topografix.com/GPX/1/1"><g:trk><g:trkseg><g:trkpt lat="0" lon="0"/><g:trkpt lat="0" lon="1"/></g:trkseg></g:trk></g:gpx>'),[[0,0],[0,1]]);
});
import assert from 'node:assert/strict';
import { diagnose, parseGpx } from './diagnose-osm-route.mjs';
test('GPX whitespace/quotes/entities work while comments and CDATA never create route points',()=>{
 const xml='<gpx><metadata><desc><![CDATA[<trkpt lat="8" lon="8"/>]]></desc></metadata><trk><trkseg><trkpt lon = "&#48;" lat = \'0\'/><!-- <trkpt lat="9" lon="9"/> --><trkpt lat = "0" lon = "0.01"/></trkseg></trk></gpx>';
 assert.deepEqual(parseGpx(xml),[[0,0],[0,.01]]);
});
test('malformed XML, blank/aliased coordinates and ambiguous tracks cannot silently form a route',()=>{
 for(const point of ['data-lat="0" lon="0"','lat=" " lon="0"','lat="0x10" lon="0"','lat="0" lat="1" lon="0"','lat="0\' lon="0"'])assert.throws(()=>parseGpx('<gpx><trkpt '+point+'/>'+ '<trkpt lat="0" lon=".01"/></gpx>'),/Invalid GPX|Malformed GPX/);
 assert.throws(()=>parseGpx('<gpx><trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon=".01"/></trkseg><trkseg><trkpt lat="1" lon="1"/></trk></gpx>'),/Malformed GPX/);
 assert.throws(()=>parseGpx('<!DOCTYPE gpx SYSTEM "https://invalid.example"><gpx/>'),/DTD\/declarations unsupported/);
 assert.throws(()=>parseGpx('<gpx><trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon=".01"/></trkseg></trk><rte><rtept lat="1" lon="1"/><rtept lat="1" lon="1.01"/></rte></gpx>'),/Multiple GPX/);
});

const point=(lat,lon)=>({lat,lon});
const osm=geometry=>({elements:[{type:'way',id:1,tags:{highway:'residential'},geometry}]});
const gpx=[point(0,0),point(0,.01)].map(p=>[p.lat,p.lon]);

test('GPX attribute order does not alter parsed coordinates',()=>{
  assert.deepEqual(parseGpx('<gpx><trkpt lon="0" lat="0"/><trkpt lat="0" lon="0.01"/></gpx>'),gpx);
  assert.deepEqual(parseGpx('<gpx><trkpt lat="0" lon="0"/><trkpt lat="0" lon="0.01"/></gpx>'),gpx);
  assert.throws(()=>parseGpx('<gpx><trkpt lat="0" lon="0"/><trkpt lat="0" lon="0.01"/><rtept lat="9" lon="9"/></gpx>'),/Multiple GPX/);
  assert.throws(()=>parseGpx('<gpx><trkpt lat="0" lon="0"/></gpx>'),/at least two/);
});
test('vendor extension names are not GPX geometry, and GPX containers need the proper parent',()=>{
 const track='<trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon=".01"/></trkseg></trk>',vendor='<extensions><x:trkseg><x:trkpt lat="9" lon="9"/><x:trkpt lat="9" lon="9.1"/></x:trkseg></extensions>',root='<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:x="urn:synthetic-vendor">';
 assert.deepEqual(parseGpx(root+track+vendor+'</gpx>'),[[0,0],[0,.01]]);
 assert.throws(()=>parseGpx(root+vendor+'</gpx>'),/at least two/);
 assert.throws(()=>parseGpx('<gpx><extensions><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon=".01"/></trkseg></extensions></gpx>'),/parent structure/);
 assert.throws(()=>parseGpx('<gpx>'+track+'<rtept lat="1" lon="1"/></gpx>'),/Multiple GPX/);
 assert.throws(()=>parseGpx('<gpx><rte><rtept lat="0" lon="0"/><rtept lat="0" lon=".01"/></rte><trkpt lat="1" lon="1"/></gpx>'),/Multiple GPX/);
});

test('a continuous road is still only a diagnostic candidate',()=>{
  const result=diagnose(gpx,osm([point(0,0),point(0,.01)]),[0,0],{startCrs:'wgs84'});
  assert.equal(result.candidateContinuous,true);
  assert.equal(result.detourCount,0);
  assert.equal(result.distance.usableTotalKm,null);
  assert.equal(result.status,'draft');
  assert.equal(result.accepted,false);
});

test('a disconnected road is never converted into a continuous route',()=>{
  const data={elements:[
    {type:'way',id:1,tags:{highway:'residential'},geometry:[point(0,0),point(0,.005)]},
    {type:'way',id:2,tags:{highway:'residential'},geometry:[point(0,.0051),point(0,.01)]}
  ]};
  const result=diagnose(gpx,data,[0,0],{startCrs:'wgs84'});
  assert.ok(result.gaps.length>0);
  assert.equal(result.candidateContinuous,false);
  assert.equal(result.distance.usableTotalKm,null);
});

test('a long U-turn detour is flagged instead of published as riding mileage',()=>{
  const result=diagnose(gpx,osm([point(0,0),point(.01,0),point(.01,.01),point(0,.01)]),[0,0],{startCrs:'wgs84'});
  assert.ok(result.detourCount>0);
  assert.ok(result.detours.some(d=>d.roadMetres>d.gpxMetres*1.6+100));
  assert.equal(result.distance.usableTotalKm,null);
});
