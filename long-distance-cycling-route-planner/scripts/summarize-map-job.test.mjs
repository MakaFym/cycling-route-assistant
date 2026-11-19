import test from 'node:test';import assert from 'node:assert/strict';
import {summarizeJob} from './summarize-map-job.mjs';
test('read-only summary exposes evidence inventory, not point arrays, arbitrary fields or invented approval',()=>{
 const points=Array.from({length:60000},()=>[30,110]),manifest={key:'NEVER_PRINT',originalGpx:{points},legs:[{type:'main',name:'Synthetic',referencePoints:points,capturedDistanceKm:2,queriedAt:'2026-10-10'}],cues:[{kind:'key'},{kind:'risk'}],supplies:[{}],removalTests:[{boundaryAfterLeg:1}]};
 const before=JSON.stringify(manifest),result=summarizeJob({manifest,acceptance:{status:'draft',errors:['No road approval'],usableTotalKm:null,totalCandidateKm:2}});
 assert.equal(result.manifest.originalGpxPoints,60000);assert.equal(result.manifest.legs[0].referencePoints,60000);assert.equal(result.manifest.keyPoints,1);assert.equal(result.acceptance.usableTotalKm,null);assert.equal(result.acceptance.deviceAcceptance,'not-tested');
 assert.ok(JSON.stringify(result).length<4000);assert.ok(!JSON.stringify(result).includes('NEVER_PRINT'));assert.equal(JSON.stringify(manifest),before);
});
test('browser summary preserves failures without promoting simulated GPS or screenshots to phone acceptance',()=>{
 const x=summarizeJob({browserResults:[{name:'phone',status:'draft',overflow:true,pageErrors:['error'],screenshotVisibility:{hidden:2},navHref:'irrelevant'}]});
 assert.equal(x.browser.viewports[0].overflow,true);assert.equal(x.browser.viewports[0].screenshotHidden,2);assert.equal(x.browser.viewports[0].pageErrorCount,1);assert.equal(x.browser.phoneAppVerified,false);assert.equal(x.browser.physicalGpsVerified,false);
 assert.throws(()=>summarizeJob({}),/input required/);assert.throws(()=>summarizeJob({acceptance:{status:'complete'}}),/Invalid acceptance/);
});
test('missing browser runtime-error evidence is unknown, not a fabricated zero',()=>{
 const x=summarizeJob({browserResults:[{name:'phone',status:'draft'}]});assert.equal(x.browser.viewports[0].pageErrorCount,null);assert.equal(x.browser.viewports[0].mapSha256,null);
});
test('local research report remains a distinct draft inventory without inventing AMap distance',()=>{
 const f={status:'draft',usableTotalKm:null,rawPointCount:5,partCount:4,days:1,topology:'open',direction:'reverse',navigationSegments:0,blockers:['No navigation evidence'],diagnostics:{distance:{originalGpxGeometryKm:9}},mapSha256:'test'};
 const x=summarizeJob({acceptance:f});assert.equal(x.acceptance.reportKind,'local-road-research');assert.equal(x.acceptance.totalCandidateKm,null);assert.equal(x.acceptance.navigationSegmentCount,0);assert.equal(x.acceptance.research.direction,'reverse');assert.deepEqual(x.acceptance.errors,f.blockers);assert.ok(!JSON.stringify(x).includes('originalGpxGeometryKm'));
 assert.throws(()=>summarizeJob({acceptance:{status:'complete',rawPointCount:5,partCount:4,blockers:[]}}),/Invalid acceptance/);
});
test('GPX-only summary is never duplicated or mislabeled as local-road research',()=>{
 const f={reportKind:'gpx-only-reference',status:'draft',usableTotalKm:null,rawPointCount:8,partCount:0,segmentCount:3,segmentGapCount:2,topology:null,direction:null,navigationSegments:0,blockers:['No road evidence']};
 const x=summarizeJob({acceptance:f});
 assert.equal(x.acceptance.reportKind,'gpx-only-reference');
 assert.deepEqual(x.acceptance.gpxOnly,{segmentCount:3,segmentGapCount:2,startName:null});
 assert.equal(Object.hasOwn(x.acceptance,'research'),false);
});
