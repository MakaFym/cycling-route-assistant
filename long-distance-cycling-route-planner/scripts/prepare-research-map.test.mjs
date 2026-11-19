import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareResearch} from './prepare-research-map.mjs';
const script=fileURLToPath(new URL('./prepare-research-map.mjs',import.meta.url));
const points=[[0,0],[0,.005],[0,.01]];
const osm={elements:[{type:'way',id:1,tags:{highway:'residential',name:'Synthetic'},geometry:points.map(([lat,lon])=>({lat,lon}))}]};
test('real-input research path keeps road candidates and never certifies navigation',()=>{
  const {data,report}=prepareResearch(points,osm,[0,0],{startCrs:'wgs84',topology:'loop',direction:'forward'});
  assert.equal(data.status,'draft');
  assert.equal(data.totalKm,null);
  assert.equal(data.navSegments.length,0);
  assert.equal(data.cues.length,0);
  assert.equal(report.rawPointCount,3);
  assert.ok(report.originalEndpointGapMetres>1000);
  assert.ok(report.closureCandidatePoints>=2);
  assert.equal(data.tileUrl,null);
  assert.ok(data.routeParts.every(p=>p.distanceKm===null&&!p.verified));
  assert.equal(data.localRoads.length,1);
  assert.deepEqual(data.originalGpx.points,points);
  assert.deepEqual(data.referenceRoutes[0].points,points);
  assert.equal(report.originalReferencePointCount,points.length);
  assert.equal(data.referenceRoutes[0].source,'original-gpx');
  assert.ok(data.routeParts.every(p=>!p.distanceEvidence));
});
test('unconnected GPX ends are not silently closed with a straight line',()=>{
  const raw={elements:[
    {type:'way',id:1,tags:{highway:'residential'},geometry:[{lat:0,lon:0},{lat:0,lon:.001}]},
    {type:'way',id:2,tags:{highway:'residential'},geometry:[{lat:0,lon:.009},{lat:0,lon:.01}]}
  ]};
  const {data,report}=prepareResearch(points,raw,[0,0],{startCrs:'wgs84',topology:'loop',direction:'forward'});
  assert.equal(report.closureCandidatePoints,0);
  assert.ok(report.blockers.some(x=>x.includes('直线闭合')));
  assert.ok(!data.routeParts.some(p=>p.name.includes('闭环道路')));
  assert.deepEqual(data.referenceRoutes[0].points,points,'Disconnected endpoints must not append a fake closing vertex to GPX');
});
test('open reverse route respects separate end and never rotates or closes the original',()=>{
  const {data,report}=prepareResearch(points,osm,[0,.009],{startCrs:'wgs84',gpxCrs:'wgs84',topology:'open',direction:'reverse',end:[0,.001],endCrs:'wgs84'});
  assert.deepEqual(data.originalGpx.points,points);
  assert.deepEqual(data.routeParts.find(p=>p.type==='main').points,[...points].reverse());
  assert.deepEqual(report.actualStart,[0,.009]);assert.deepEqual(report.actualEnd,[0,.001]);
  assert.equal(report.closureCandidatePoints,0);assert.equal(report.topology,'open');
  assert.equal(data.topology,'open');assert.equal(data.direction,'reverse');assert.ok(data.routeParts.filter(p=>p.type==='return').every(p=>p.name.includes('终点接驳')&&!p.name.includes('返程')));
  assert.ok(!data.routeParts.some(p=>p.name.includes('首尾闭环道路')));
  assert.ok(!data.note.includes('地铁'));assert.ok(!data.note.includes('往返道路代价'));assert.ok(data.note.includes('指定方向的路书首尾'));assert.equal(report.days,1);
  assert.equal(data.totalKm,null);assert.equal(data.navSegments.length,0);
  assert.equal(report.acceptance.routeRideability.status,'not-accepted');
});
test('open route defaults end to oriented GPX endpoint, not actual start',()=>{
  const {report}=prepareResearch(points,osm,[0,.005],{startCrs:'wgs84',gpxCrs:'wgs84',topology:'open',direction:'reverse'});
  assert.deepEqual(report.actualEnd,points[0]);
});
test('missing topology/direction and invalid actual endpoints or days are rejected',()=>{
  const opts={startCrs:'wgs84',topology:'loop',direction:'forward'};
  assert.throws(()=>prepareResearch(points,osm,[0,0],{startCrs:'wgs84'}),/Explicit topology/);
  assert.throws(()=>prepareResearch(points,osm,[91,0],opts),/coordinates/);
  assert.throws(()=>prepareResearch(points,osm,[0,0],{...opts,end:[0,.01]}),/endCrs/);
  assert.throws(()=>prepareResearch(points,osm,[0,0],{...opts,days:1.5}),/positive integer/);
});
test('--help is self-contained, successful, and produces no files',async t=>{
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'prepare-research-help-'));
  t.after(()=>fs.rm(cwd,{recursive:true,force:true}));
  const result=spawnSync(process.execPath,[script,'--help'],{cwd,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  for(const option of ['--gpx','--osm','--start','--start-crs','--topology','--direction','--out-dir'])assert.match(result.stdout,new RegExp(option));
  assert.match(result.stdout,/research|研究/i);
  assert.match(result.stdout,/draft|草稿/i);
  assert.match(result.stdout,/not navigation mileage|不是导航里程/i);
  assert.equal(result.stderr,'');
  assert.deepEqual(await fs.readdir(cwd),[]);
});
test('unknown, duplicate, and missing CLI options remain errors',()=>{
  for(const args of [[],['--unknown','value'],['--gpx','a','--gpx','b'],['--help','--help']]){
    const result=spawnSync(process.execPath,[script,...args],{encoding:'utf8'});
    assert.notEqual(result.status,0,'unexpected success for '+JSON.stringify(args));
    assert.match(result.stderr,/Unknown, duplicate or missing CLI option|Missing --/);
  }
});
