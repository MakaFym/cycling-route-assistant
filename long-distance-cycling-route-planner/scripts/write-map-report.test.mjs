import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {buildJobReport} from './write-map-report.mjs';
function fixture(){
 const data={status:'draft',totalKm:null,routeParts:[{type:'main',name:'Synthetic',points:[[0,0],[0,.01]],distanceKm:12.074,distanceEvidence:{type:'amap-api-v5',queriedAt:'2026-10-10',key:'NEVER_EXPORT'}}],navSegments:[],originalGpx:{points:[[0,0],[0,.01]]},cues:[],supplies:[],turnCandidates:[]};
 const mapHtml='const D='+JSON.stringify(data)+';\nconst $=x=>x;',mapSha256=createHash('sha256').update(mapHtml).digest('hex');
 const acceptance={status:'draft',mapSha256,usableTotalKm:null,totalCandidateKm:12.074,navigationTotalKm:12.074,validLegCount:1,legCount:1,errors:['No road approval'],queryDates:['2026-10-10'],fidelityReports:[{leg:1,comparisonScope:'partial-original-span',referenceSpanCount:2,referenceGeometryKm:12.339174493884558,comparedGeometryKm:12.122997322921583,ratio:.9824804186803489,maxMetres:9379.066105318627,p95Metres:7240.29}]};
 const browserResults=['phone','desktop'].map(name=>({name,mapSha256,status:'draft',overflow:false,buttonVisible:true,coveredPoints:0,outOfViewport:0,hiddenReferencePoints:0,pointsUnderControls:0,screenshotVisibility:{hidden:0},originalReferencePreserved:true,noteMatchesData:true,pageErrors:[]}));
 return {mapHtml,acceptance,browserResults};
}
function gpxOnlyFixture(){
 const data={mode:'gpx-only-reference',status:'draft',topology:null,direction:null,totalKm:null,tileUrl:null,routeParts:[],navSegments:[],originalGpx:{segments:[[[0,0],[0,.01]]]},referenceRoutes:[{points:[[0,0],[0,.01]]}],cues:[],supplies:[],optionalRoutes:[],turnCandidates:[],localRoads:[],researchMarkers:[]};
 const mapHtml='const D='+JSON.stringify(data)+';\nconst $=x=>x;',mapSha256=createHash('sha256').update(mapHtml).digest('hex');
 const acceptance={reportKind:'gpx-only-reference',status:'draft',mapSha256,usableTotalKm:null,partCount:0,navigationSegments:0,originalReferencePointCount:2,blockers:['No road evidence']};
 const browserResults=['phone','desktop'].map(name=>({name,mapSha256,status:'draft',mode:'gpx-only-reference',topology:null,direction:null,parts:0,points:0,total:'总里程待核实',tileUrlPresent:true,tileUrl:null,tileLayerCount:0,cueCount:0,keyCueCount:0,supplyCount:0,optionalRouteCount:0,turnCandidateCount:0,localRoadCount:0,researchMarkerCount:0,navigationRoutePartsPresent:false,actualStartPresent:false,actualEndPresent:false,tileAttributionPresent:false,pendingChecksHasUndefined:false,originalGpxSegments:1,segmentLinks:0,nextLabel:'未生成导航终点',nextStatHidden:true,focusHidden:true,overflow:false,buttonVisible:true,coveredPoints:0,outOfViewport:0,hiddenReferencePoints:0,pointsUnderControls:0,screenshotVisibility:{hidden:0},originalReferencePreserved:true,noteMatchesData:true,pageErrors:[]}));
 return {mapHtml,acceptance,browserResults};
}
function mutateGpxData(f,change){
 const data=JSON.parse(f.mapHtml.match(/^const D=(.*);/m)[1]);change(data);
 f.mapHtml='const D='+JSON.stringify(data)+';\nconst $=x=>x;';
 f.acceptance.mapSha256=createHash('sha256').update(f.mapHtml).digest('hex');
 f.browserResults.forEach(x=>x.mapSha256=f.acceptance.mapSha256);
 return f;
}
test('source-derived report keeps three distance types, partial scope, original date and draft guard',()=>{
 const f=fixture(),before=JSON.stringify(f),{facts,markdown}=buildJobReport({...f,generatedAt:'2030-01-01T00:00:00Z'});
 assert.equal(facts.skillGeneration.status,'passed');assert.equal(facts.routeRideability.status,'not-accepted');assert.equal(facts.routeRideability.usableTotalKm,null);
 assert.deepEqual(facts.comparisons[0],{leg:1,scope:'partial-original-span',geometrySource:null,referenceSpanCount:2,referenceGeometryKm:12.339174493884558,comparedGeometryKm:12.122997322921583,navigationDistanceKm:12.074,ratio:.9824804186803489,p95Metres:7240.29,maxMetres:9379.066105318627});
 assert.deepEqual(facts.mileage.queryDates,['2026-10-10']);assert.equal(facts.routeRideability.physicalDeviceVerifiedByThisTool,false);assert.equal(facts.points.approvedManualSwitches,null);
 assert.equal(Object.hasOwn(facts.skillGeneration,'dataContract'),false);
 assert.ok(!JSON.stringify(facts).includes('NEVER_EXPORT'));assert.ok(!Object.hasOwn(facts,'evidenceValid'));assert.ok(markdown.includes('12.339 | 12.123 | 12.074'));assert.equal(JSON.stringify(f),before);
});
test('stale hash/status rejects, unbound or incomplete QA cannot become a pass',()=>{
 const f=fixture();f.browserResults[0].mapSha256='0'.repeat(64);assert.throws(()=>buildJobReport(f),/Stale browser/);
 delete f.browserResults[0].mapSha256;delete f.browserResults[1].mapSha256;assert.equal(buildJobReport(f).facts.skillGeneration.status,'not-tested');
 f.browserResults[0].status='complete';assert.throws(()=>buildJobReport(f),/status differs/);
 const x=fixture();delete x.browserResults[0].pageErrors;assert.equal(buildJobReport(x).facts.skillGeneration.status,'not-tested');
 const y=fixture();y.browserResults[0].screenshotVisibility.hidden=1;assert.equal(buildJobReport(y).facts.skillGeneration.status,'failed');
});
test('incomplete components cannot guess navigation-distance mapping from array position',()=>{
 const f=fixture();f.acceptance.legCount=2;f.acceptance.fidelityReports[0].leg=2;
 assert.equal(buildJobReport(f).facts.comparisons[0].navigationDistanceKm,null);
});
test('acceptance from another draft cannot borrow the current map QA',()=>{
 const f=fixture();delete f.acceptance.mapSha256;assert.throws(()=>buildJobReport(f),/Unbound or stale acceptance/);
 f.acceptance.mapSha256='0'.repeat(64);assert.throws(()=>buildJobReport(f),/Unbound or stale acceptance/);
 const x=fixture();x.acceptance.validLegCount=2;assert.throws(()=>buildJobReport(x),/source field differ/);
 const y=fixture();delete y.browserResults[0].pageErrors;y.browserResults[0].overflow=true;assert.equal(buildJobReport(y).facts.skillGeneration.status,'failed');
});
test('web approximate precision, independent geometry and review actions survive factual reporting',()=>{
 const f=fixture(),d=JSON.parse(f.mapHtml.match(/^const D=(.*);/m)[1]);
 d.status='complete';d.totalKm=12.3;d.totalApproximate=true;d.routeParts[0].distanceKm=12.3;
 d.routeParts[0].distanceEvidence={type:'amap-mobile-web',queriedAt:'2026-10-10',label:'12.3公里',displayedDecimals:1,roundingRuleKnown:false,uri:'PRIVATE_URI',key:'NEVER_EXPORT'};
 d.navSegments=[{...d.routeParts[0],name:'Web group'}];
 f.mapHtml='const D='+JSON.stringify(d)+';\nconst $=x=>x;';f.acceptance.mapSha256=createHash('sha256').update(f.mapHtml).digest('hex');
 Object.assign(f.acceptance,{status:'complete',usableTotalKm:12.3,totalCandidateKm:12.3,navigationTotalKm:12.3,warnings:['Rounding uncertainty unknown'],reviewStatus:{pendingChecks:[{code:'ENTRY',description:'Verify entrance',owner:'field',action:'Check lawful passage'}],deviceAcceptance:{status:'not-tested',owner:'device',action:'Test phone App'}}});
 f.acceptance.fidelityReports[0].geometrySource='original-gpx';
 f.browserResults.forEach(x=>{x.mapSha256=f.acceptance.mapSha256;x.status='complete';});
 const {facts,markdown}=buildJobReport(f);
 assert.equal(facts.mileage.totalApproximate,true);assert.equal(facts.mileage.navigationSegments[0].evidence.displayedDecimals,1);assert.equal(facts.mileage.parts[0].evidence.roundingRuleKnown,false);
 assert.equal(facts.comparisons[0].geometrySource,'original-gpx');assert.equal(facts.pendingChecks[0].action,'Check lawful passage');
 assert.ok(markdown.includes('可交付总里程：约 12.3'));assert.ok(markdown.includes('累计误差未知'));assert.ok(markdown.includes('不是网页导出的高德算路折线'));assert.ok(markdown.includes('Verify entrance'));assert.ok(markdown.includes('Test phone App'));
 assert.ok(!JSON.stringify(facts).includes('PRIVATE_URI'));assert.ok(!JSON.stringify(facts).includes('NEVER_EXPORT'));
});
test('skipped GPS samples stay unknown or partial, never become automatic-selection coverage',()=>{
 const f=fixture();f.browserResults[0].gpsSegmentSelection={cases:[],skipped:[{segment:1,reason:'overlap'}]};
 let r=buildJobReport(f);assert.equal(r.facts.skillGeneration.viewports[0].gpsSimulation.status,'not-tested');assert.ok(r.markdown.includes('overlap'));
 f.browserResults[0].gpsSegmentSelection.cases.push({segment:2});r=buildJobReport(f);assert.equal(r.facts.skillGeneration.viewports[0].gpsSimulation.status,'partial');
 assert.ok(r.facts.skillGeneration.scope.includes('GPS sample coverage reported separately'));
});
test('GPX-only report requires mode-specific browser evidence before passing software checks',()=>{
 const complete=gpxOnlyFixture();assert.equal(buildJobReport(complete).facts.skillGeneration.status,'passed');
 for(const field of ['mode','parts','topology','direction','total','tileUrlPresent','tileUrl','tileLayerCount','cueCount','keyCueCount','supplyCount','optionalRouteCount','turnCandidateCount','localRoadCount','researchMarkerCount','navigationRoutePartsPresent','actualStartPresent','actualEndPresent','tileAttributionPresent','pendingChecksHasUndefined','originalGpxSegments','segmentLinks','nextLabel','nextStatHidden','focusHidden']){
  const f=gpxOnlyFixture();delete f.browserResults[0][field];
  assert.equal(buildJobReport(f).facts.skillGeneration.status,'not-tested','missing '+field+' must not pass');
 }
 const wrong=gpxOnlyFixture();wrong.browserResults[0].parts=1;
 assert.equal(buildJobReport(wrong).facts.skillGeneration.status,'failed');
});
test('GPX-only data contract blocks key cues and online or ambiguous tile settings',()=>{
 const cue=mutateGpxData(gpxOnlyFixture(),data=>data.cues.push({name:'Forbidden key',kind:'key',point:[0,0]}));
 assert.equal(buildJobReport(cue).facts.skillGeneration.status,'failed');
 const missing=mutateGpxData(gpxOnlyFixture(),data=>delete data.tileUrl);
 assert.equal(buildJobReport(missing).facts.skillGeneration.status,'not-tested');
 const online=mutateGpxData(gpxOnlyFixture(),data=>data.tileUrl='https://tiles.invalid/{z}/{x}/{y}.png');
 assert.equal(buildJobReport(online).facts.skillGeneration.status,'failed');
 const missingPrompts=mutateGpxData(gpxOnlyFixture(),data=>delete data.cues);
 assert.equal(buildJobReport(missingPrompts).facts.skillGeneration.status,'not-tested');
 const located=mutateGpxData(gpxOnlyFixture(),data=>data.actualStart=[0,0]);
 assert.equal(buildJobReport(located).facts.skillGeneration.status,'failed');
 const navigation=mutateGpxData(gpxOnlyFixture(),data=>data.navigationRouteParts=[]);
 assert.equal(buildJobReport(navigation).facts.skillGeneration.status,'failed');
});
test('GPX-only browser contract binds tile and forbidden-layer evidence',()=>{
 const missing=gpxOnlyFixture();delete missing.browserResults[0].tileLayerCount;
 assert.equal(buildJobReport(missing).facts.skillGeneration.status,'not-tested');
 const wrong=gpxOnlyFixture();wrong.browserResults[0].keyCueCount=1;
 assert.equal(buildJobReport(wrong).facts.skillGeneration.status,'failed');
});
test('CLI writes a new report from artifact files without overwriting them or prior results',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'map-report-cli-')),f=fixture(),inputs=[['map.html',f.mapHtml],['acceptance.json',JSON.stringify(f.acceptance)],['browser.json',JSON.stringify(f.browserResults)]];
 for(const [name,body] of inputs)await fs.writeFile(path.join(dir,name),body);
 const args=['--map',path.join(dir,'map.html'),'--acceptance',path.join(dir,'acceptance.json'),'--browser-results',path.join(dir,'browser.json'),'--out-md',path.join(dir,'report.md'),'--out-json',path.join(dir,'report-data.json')],script=fileURLToPath(new URL('./write-map-report.mjs',import.meta.url));
 const first=spawnSync(process.execPath,[script,...args],{encoding:'utf8',windowsHide:true});assert.equal(first.status,0,first.stderr);
 assert.equal(JSON.parse(await fs.readFile(path.join(dir,'report-data.json'),'utf8')).skillGeneration.status,'passed');
 assert.equal(spawnSync(process.execPath,[script,...args],{encoding:'utf8',windowsHide:true}).status,1);
 for(const [name,body] of inputs)assert.equal(await fs.readFile(path.join(dir,name),'utf8'),body);
});
