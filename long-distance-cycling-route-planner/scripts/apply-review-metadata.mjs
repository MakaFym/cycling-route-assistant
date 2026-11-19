import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {isEvidenceDate} from './evidence-dates.mjs';
import {reviewStatus} from './review-status.mjs';

const top=new Set(['title','subtitle','note','cues','supplies','turnCandidates','review','legs','navigationGroups']);
const item=new Set(['index','name','reason','endMandatory','mandatoryKind','mandatoryEvidence','alignmentReview']);
const review=new Set(['routeAndRoadsChecked','navDeletionChecked','accessChecked','checkedAt','evidence','pendingChecks']);
const mandatory=new Set(['planned_stop','route_join','route_leave','overnight','option_boundary','access_boundary']);
function object(value,label){if(!value||typeof value!=='object'||Array.isArray(value))throw Error(label+' must be an object');}
function allowed(value,keys,label){object(value,label);for(const k of Object.keys(value))if(!keys.has(k))throw Error('Unsupported '+label+' field: '+k);}
function safeJson(value){
 if(Array.isArray(value)){for(const v of value)safeJson(v);return;}
 if(value&&typeof value==='object')for(const [k,v] of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(k))throw Error('Unsafe property name');safeJson(v);}
 else if(typeof value==='number'&&!Number.isFinite(value))throw Error('Non-finite number');
}
function evidence(value,label){if(typeof value!=='string'||value.trim().length<20)throw Error(label+' needs concrete evidence');}
function patches(result,key,changes){
 if(!Array.isArray(changes)||!Array.isArray(result[key]))throw Error(key+' must be existing indexed items');
 const seen=new Set();
 for(const change of changes){
  allowed(change,item,key);const i=change.index;
  if(!Number.isInteger(i)||i<1||i>result[key].length||seen.has(i))throw Error('Invalid or repeated '+key+' index');seen.add(i);
  const target=result[key][i-1];
  for(const [k,v] of Object.entries(change))if(k!=='index')target[k]=structuredClone(v);
  for(const k of ['name','reason'])if(k in change&&(typeof change[k]!=='string'||!change[k].trim()))throw Error(k+' must be nonempty text');
  if('endMandatory' in change&&typeof change.endMandatory!=='boolean')throw Error('endMandatory must be boolean');
  if(target.endMandatory===true){if(!mandatory.has(target.mandatoryKind))throw Error('Invalid mandatoryKind');evidence(target.mandatoryEvidence,'mandatory boundary');}
  if('alignmentReview' in change){
   allowed(change.alignmentReview,new Set(['checked','checkedAt','outcome','evidence']),'alignmentReview');
   const r=change.alignmentReview;if(typeof r.checked!=='boolean')throw Error('alignmentReview.checked must be boolean');
   if(r.checked===true){if(!isEvidenceDate(r.checkedAt)||!['same-corridor','accepted-local-reroute'].includes(r.outcome))throw Error('Invalid alignmentReview date or outcome');evidence(r.evidence,'alignmentReview');}
  }
 }
}
export function applyReviewMetadata(manifest,patch){
 object(manifest,'manifest');if(!Array.isArray(manifest.legs)||!manifest.legs.length)throw Error('Manifest needs legs');
 allowed(patch,top,'patch');safeJson(patch);const result=structuredClone(manifest);
 for(const [key,value] of Object.entries(patch)){
  if(['legs','navigationGroups'].includes(key)){patches(result,key,value);continue;}
  if(key==='review'){
   allowed(value,review,'review');result.review={...result.review,...structuredClone(value)};
   for(const k of ['routeAndRoadsChecked','navDeletionChecked','accessChecked'])if(k in result.review&&typeof result.review[k]!=='boolean')throw Error(k+' must be boolean');
   if(['routeAndRoadsChecked','navDeletionChecked','accessChecked'].some(k=>result.review[k]===true)){if(!isEvidenceDate(result.review.checkedAt))throw Error('Review date invalid');evidence(result.review.evidence,'review');}
   reviewStatus(result.review);continue;
  }
  if(['cues','supplies','turnCandidates'].includes(key)){if(!Array.isArray(value))throw Error(key+' must be an array');}
  else if(typeof value!=='string')throw Error(key+' must be text');
  result[key]=structuredClone(value);
 }
 return result;
}
async function main(args){
 const values={};if(args.length!==6)throw Error('Use --manifest FILE --patch FILE --out FILE');
 for(let i=0;i<args.length;i+=2){if(!['--manifest','--patch','--out'].includes(args[i])||values[args[i]]!==undefined)throw Error('Unknown or repeated option');values[args[i]]=args[i+1];}
 if(Object.keys(values).length!==3)throw Error('Use --manifest FILE --patch FILE --out FILE');
 const mf=path.resolve(values['--manifest']),out=path.resolve(values['--out']);
 if(path.dirname(out).toLowerCase()!==path.dirname(mf).toLowerCase()||out.toLowerCase()===mf.toLowerCase())throw Error('Output must be a new sibling manifest; preserve relative evidence paths');
 const manifest=JSON.parse(await fs.readFile(mf,'utf8')),patch=JSON.parse(await fs.readFile(values['--patch'],'utf8'));
 const result=applyReviewMetadata(manifest,patch);
 await fs.writeFile(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({metadataApplied:true,routeEvidenceChanged:false,routeApproved:false,output:path.basename(out)}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1});
