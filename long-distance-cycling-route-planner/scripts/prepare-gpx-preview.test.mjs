import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGpxGeometry} from './diagnose-osm-route.mjs';
import {prepareGpxPreview} from './prepare-gpx-preview.mjs';
import {renderMap} from './assemble-amap-map.mjs';

const point=(lat,lon)=>`<trkpt lat="${lat}" lon="${lon}"/>`;
const document=(version,segments)=>`<?xml version="1.0"?><gpx version="${version}" xmlns="http://www.topografix.com/GPX/${version}"><trk><name>Input</name>${segments.map(x=>`<trkseg>${x.map(p=>point(...p)).join('')}</trkseg>`).join('')}</trk></gpx>`;
const routeDocument=(version,routes)=>`<?xml version="1.0"?><gpx version="${version}" xmlns="http://www.topografix.com/GPX/${version}">${routes.map(x=>`<rte>${x.map(([lat,lon])=>`<rtept lat="${lat}" lon="${lon}"/>`).join('')}</rte>`).join('')}</gpx>`;
const segments=[[[31,120],[31.01,120.01]],[[31.2,120.2],[31.21,120.21]],[[31.4,120.4],[31.41,120.41]]];

test('GPX 1.0 and 1.1 parse into preserved source segments',()=>{
 for(const version of ['1/0','1/1']){
  const parsed=parseGpxGeometry(document(version,segments.slice(0,1)));
  assert.deepEqual(parsed.segments,segments.slice(0,1));
  assert.equal(parsed.sourceKind,'track');
 }
});

test('GPX route sources preserve independent rte geometry in the preview',()=>{
 for(const version of ['1/0','1/1']){
  const parsed=parseGpxGeometry(routeDocument(version,segments.slice(0,2)));
  assert.equal(parsed.sourceKind,'route');
  assert.deepEqual(parsed.segments,segments.slice(0,2));
  const {data,report}=prepareGpxPreview(parsed);
  assert.deepEqual(data.referenceRoutes.map(x=>x.points),segments.slice(0,2));
  assert.ok(data.referenceRoutes.every(x=>x.name.includes('路线段')));
  assert.equal(report.segmentGapCount,1);
 }
});

test('GPX-only preview preserves segment gaps and never infers route intent',()=>{
 const parsed=parseGpxGeometry(document('1/1',segments));
 const {data,report}=prepareGpxPreview(parsed,{startName:'某区附近'});
 assert.equal(data.mode,'gpx-only-reference');
 assert.equal(data.status,'draft');
 assert.equal(data.totalKm,null);
 assert.equal(data.topology,null);
 assert.equal(data.direction,null);
 assert.equal(data.startName,'某区附近');
 assert.equal(Object.hasOwn(data,'actualStart'),false);
 assert.deepEqual(data.routeParts,[]);
 assert.deepEqual(data.navSegments,[]);
 assert.equal(data.referenceRoutes.length,3);
 assert.deepEqual(data.referenceRoutes.map(x=>x.points),segments);
 assert.deepEqual(data.originalGpx.segments,segments);
 assert.equal(report.segmentGapCount,2);
 assert.equal(report.navigationSegments,0);
 assert.equal(report.usableTotalKm,null);
 assert.ok(data.reviewStatus.pendingChecks.every(x=>typeof x.name==='string'&&!x.name.includes('undefined')));
 assert.match(data.note,/未选择拓扑和方向/);
 assert.match(data.note,/段间空白/);
 assert.match(data.note,/详细底图和道路服务/);
});

test('malformed, ambiguous, or underspecified GPX stays rejected',()=>{
 assert.throws(()=>parseGpxGeometry('<gpx><trk><trkseg><trkpt lat="0" lon="0"></trkseg></trk></gpx>'),/Malformed GPX/);
 assert.throws(()=>parseGpxGeometry('<gpx><trk><trkseg><trkpt lat="0" lon="0"/></trkseg></trk></gpx>'),/at least two/);
 assert.throws(()=>parseGpxGeometry('<gpx><trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="1"/></trkseg></trk><rte><rtept lat="1" lon="1"/><rtept lat="1" lon="2"/></rte></gpx>'),/Multiple GPX/);
});

test('script-like optional labels remain data and are escaped in bundled HTML',async()=>{
 const parsed=parseGpxGeometry(document('1/1',segments.slice(0,1)));
 const label='</script><script>globalThis.pwned=true</script>';
 const {data}=prepareGpxPreview(parsed,{startName:label,title:label});
 const template='<!doctype html><script>const D=__ROUTE_DATA_JSON__;\nconst $=x=>x;</script>';
 const html=await renderMap(template,data);
 assert.equal(html.includes(label),false);
 assert.ok(html.includes('\\u003c/script>'));
 assert.equal((html.match(/<script>/g)||[]).length,1);
});
