import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const text=x=>typeof x==='string'?x.slice(0,800):null;
const count=x=>Array.isArray(x)?x.length:0;
// Read-only, bounded metadata. Never emit GPX/route point arrays or claim road approval.
export function summarizeJob({manifest,acceptance,browserResults}={}){
 const summary={scope:'Evidence inventory and software checks only; not independent road/device certification'};
 if(manifest){
  if(!Array.isArray(manifest.legs))throw Error('Manifest legs must be an array');
  summary.manifest={title:text(manifest.title),days:manifest.days??1,originalGpxPoints:count(manifest.originalGpx?.points),legs:manifest.legs.map((x,i)=>({index:i+1,type:text(x.type),name:text(x.name),capturedDistanceKm:x.capturedDistanceKm??null,queriedAt:text(x.queriedAt??manifest.queriedAt),referencePoints:count(x.referencePoints),referenceSpans:count(x.referenceSpans),referenceScope:text(x.referenceScope),mandatory:x.endMandatory===true,mandatoryKind:text(x.mandatoryKind),alignmentReviewed:x.alignmentReview?.checked===true})),navigationGroups:count(manifest.navigationGroups),deletionBoundaries:(manifest.removalTests||[]).map(x=>x.boundaryAfterLeg),cues:count(manifest.cues),keyPoints:(manifest.cues||[]).filter(x=>x.kind==='key').length,supplies:count(manifest.supplies),turnCandidates:count(manifest.turnCandidates)};
 }
 if(acceptance){
  const declaredKind=text(acceptance.reportKind);
  const legacyResearch=!declaredKind&&acceptance.status==='draft'&&Array.isArray(acceptance.blockers)&&Number.isInteger(acceptance.rawPointCount)&&Number.isInteger(acceptance.partCount);
  const reportKind=declaredKind??(legacyResearch?'local-road-research':'amap-assembly');
  const research=reportKind==='local-road-research',gpxOnly=reportKind==='gpx-only-reference';
  const issues=research||gpxOnly?acceptance.blockers:acceptance.errors;
  if(!['amap-assembly','local-road-research','gpx-only-reference'].includes(reportKind)||!['draft','complete'].includes(acceptance.status)||research&&acceptance.status!=='draft'||gpxOnly&&acceptance.status!=='draft'||!Array.isArray(issues))throw Error('Invalid acceptance report');
  summary.acceptance={reportKind,status:acceptance.status,totalCandidateKm:acceptance.totalCandidateKm??null,usableTotalKm:acceptance.usableTotalKm??null,validLegCount:acceptance.validLegCount??null,navigationSegmentCount:acceptance.navigationSegmentCount??acceptance.navigationSegments??null,queryDates:acceptance.queryDates??[],errors:issues.map(text),warnings:(acceptance.warnings||[]).map(text),deviceAcceptance:acceptance.reviewStatus?.deviceAcceptance??'not-tested'};
  if(research)summary.acceptance.research={rawPointCount:acceptance.rawPointCount,partCount:acceptance.partCount,days:acceptance.days??null,topology:text(acceptance.topology),direction:text(acceptance.direction),verifiedKeyPoints:acceptance.verifiedKeyPoints??null};
  if(gpxOnly)summary.acceptance.gpxOnly={segmentCount:acceptance.segmentCount??null,segmentGapCount:acceptance.segmentGapCount??null,startName:text(acceptance.startName)};
 }
 if(browserResults){
  if(!Array.isArray(browserResults)||browserResults.length>30)throw Error('Browser results must be a bounded array');
  summary.browser={viewports:browserResults.map(x=>({name:text(x.name),status:text(x.status),mapSha256:text(x.mapSha256),overflow:x.overflow,buttonVisible:x.buttonVisible,coveredPoints:x.coveredPoints,outOfViewport:x.outOfViewport,hiddenReferencePoints:x.hiddenReferencePoints,pointsUnderControls:x.pointsUnderControls??null,screenshotHidden:x.screenshotVisibility?.hidden??null,originalReferencePreserved:x.originalReferencePreserved,noteMatchesData:x.noteMatchesData,segmentLinks:x.segmentLinks,pageErrorCount:Array.isArray(x.pageErrors)?x.pageErrors.length:null})),physicalGpsVerified:false,phoneAppVerified:false};
 }
 if(Object.keys(summary).length===1)throw Error('At least one job input required');
 return summary;
}
async function main(args){
 const allowed=new Set(['--manifest','--acceptance','--browser-results']),v={};
 for(let i=0;i<args.length;i+=2){if(!allowed.has(args[i])||args[i+1]===undefined||Object.hasOwn(v,args[i]))throw Error('Unknown, repeated or missing option');v[args[i]]=args[i+1];}
 const inputs={};for(const [flag,key] of [['--manifest','manifest'],['--acceptance','acceptance'],['--browser-results','browserResults']])if(v[flag])inputs[key]=JSON.parse(await fs.readFile(v[flag],'utf8'));
 console.log(JSON.stringify(summarizeJob(inputs)));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1});
