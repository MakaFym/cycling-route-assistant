import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseAmapBicycleV5} from './assemble-amap-map.mjs';

function gcj(p){
  const [lat,lng]=p,R=Math.PI/180;
  if(lng<72.004||lng>137.8347||lat<.8293||lat>55.8271)return p;
  const x=lng-105,y=lat-35;
  let a=-100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x));
  let b=300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x));
  a+=(20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3+(20*Math.sin(y*Math.PI)+40*Math.sin(y/3*Math.PI))*2/3+(160*Math.sin(y/12*Math.PI)+320*Math.sin(y*Math.PI/30))*2/3;
  b+=(20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3+(20*Math.sin(x*Math.PI)+40*Math.sin(x/3*Math.PI))*2/3+(150*Math.sin(x/12*Math.PI)+300*Math.sin(x*Math.PI/30))*2/3;
  const e=.00669342162296594323,A=6378245,s=Math.sin(lat*R),m=1-e*s*s,k=Math.sqrt(m);
  return [lat+a*180/((A*(1-e))/(m*k)*Math.PI),lng+b*180/(A/k*Math.cos(lat*R)*Math.PI)];
}
export {gcj as wgsToGcj};

// Scheduling observers stay outside all network client arguments.
const REQUEST_STARTED=Symbol('cycling.request.started');

export function createPacedRequest(request=fetch,{intervalMs=400,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  if(!Number.isFinite(intervalMs)||intervalMs<0)throw Error('Invalid request interval');
  let nextAt=-Infinity,queue=Promise.resolve();
  const schedule=(args,observe)=>{
    const task=queue.then(async()=>{
      const wait=nextAt-now();if(wait>0)await sleep(wait);
      const startedAt=now();nextAt=startedAt+intervalMs;
      observe?.(new Date(startedAt).toISOString());
      return request(...args);
    });
    queue=task.catch(()=>{});
    return task;
  };
  const paced=(...args)=>schedule(args);
  paced[REQUEST_STARTED]=(observe,...args)=>schedule(args,observe);
  return paced;
}

export function buildApiManifest(manifest,removal,queriedAt=new Date().toISOString()){
  return {...manifest,queriedAt,legs:manifest.legs.map((leg,i)=>{
    const {geometryEvidence,evidenceType,responseFile,...metadata}=leg;
    return {...metadata,...(metadata.referencePoints?{referenceSource:metadata.referenceSource||geometryEvidence?.source||'provided-reference'}:{}),queriedAt,evidenceType:'amap-api-v5',responseFile:'leg-'+String(i+1).padStart(2,'0')+'.json'};
  }),...(manifest.navigationGroups?{navigationGroups:manifest.navigationGroups.map((g,i)=>({...g,queriedAt,evidenceType:'amap-api-v5',responseFile:'navigation-group-'+String(i+1).padStart(2,'0')+'.json'}))}:{}),removalTests:removal.map(x=>({boundaryAfterLeg:x.boundaryAfterLeg,queriedAt,evidenceType:'amap-api-v5',responseFile:'merge-after-'+String(x.boundaryAfterLeg).padStart(2,'0')+'.json'}))};
}

export function navigationSpans(manifest){
  if(!Array.isArray(manifest?.legs)||!manifest.legs.length)throw Error('Manifest has no legs');
  if(!manifest.navigationGroups)return manifest.legs.map((_,i)=>({firstLeg:i+1,lastLeg:i+1}));
  if(!Array.isArray(manifest.navigationGroups)||!manifest.navigationGroups.length)throw Error('Navigation groups must partition all component legs in order');
  let cursor=1;
  for(const g of manifest.navigationGroups){
    if(!Number.isInteger(g.firstLeg)||!Number.isInteger(g.lastLeg)||g.firstLeg!==cursor||g.lastLeg<cursor||g.lastLeg>manifest.legs.length||!g.name||!g.reason)throw Error('Navigation groups must partition all component legs in order');
    cursor=g.lastLeg+1;
  }
  if(cursor!==manifest.legs.length+1)throw Error('Navigation groups omit component legs');
  return manifest.navigationGroups;
}

function removalQueries(manifest){
  const spans=navigationSpans(manifest),queries=[];
  for(let i=0;i<spans.length-1;i++){
    const left=spans[i],right=spans[i+1];
    const boundary=Object.hasOwn(left,'endMandatory')?left:manifest.legs[left.lastLeg-1];
    if(boundary.endMandatory===true)continue;
    queries.push({stage:'merge-after',index:left.lastLeg,boundaryAfterLeg:left.lastLeg,firstLeg:left.firstLeg,lastLeg:right.lastLeg,
      start:manifest.legs[left.firstLeg-1].start,end:manifest.legs[right.lastLeg-1].end});
  }
  return queries;
}

// Local only: no Key, URLs, quota/account calls, or assumed road approval.
export function planCollection(manifest,{maxRequests}={}){
  const spans=navigationSpans(manifest);
  const valid=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180;
  manifest.legs.forEach((leg,i)=>{if(!valid(leg?.start)||!valid(leg?.end))throw Error('Invalid start or end in leg '+(i+1)+'; collection not started');});
  if(maxRequests!==undefined&&(!Number.isSafeInteger(maxRequests)||maxRequests<0))throw Error('maxRequests must be a non-negative safe integer');
  const requests=manifest.legs.map((leg,i)=>({stage:'leg',index:i+1,firstLeg:i+1,lastLeg:i+1,start:leg.start,end:leg.end}));
  if(manifest.navigationGroups)spans.forEach((g,i)=>{if(g.firstLeg!==g.lastLeg)requests.push({stage:'navigation-group',index:i+1,firstLeg:g.firstLeg,lastLeg:g.lastLeg,start:manifest.legs[g.firstLeg-1].start,end:manifest.legs[g.lastLeg-1].end});});
  requests.push(...removalQueries(manifest));
  return {requests,navigationTasks:spans.length,candidateManualSwitches:Math.max(0,spans.length-1),
    maxRequests:maxRequests??null,withinBudget:maxRequests===undefined?null:requests.length<=maxRequests,
    requestCounts:{legs:manifest.legs.length,navigationGroups:requests.filter(x=>x.stage==='navigation-group').length,deletions:requests.filter(x=>x.stage==='merge-after').length},
    reusedSingletonGroups:manifest.navigationGroups?spans.filter(x=>x.firstLeg===x.lastLeg).length:0};
}

export function summarizeCollectionPlan(plan){
  return {scope:'Local whole-batch request plan only; not authorization, quota, pricing, distance or road approval',
    plannedRequests:plan.requests.length,requestCounts:plan.requestCounts,navigationTasks:plan.navigationTasks,candidateManualSwitches:plan.candidateManualSwitches,
    reusedSingletonGroups:plan.reusedSingletonGroups,maxRequests:plan.maxRequests,withinBudget:plan.withinBudget,
    requests:plan.requests.map(({stage,index,firstLeg,lastLeg,boundaryAfterLeg})=>({stage,index,firstLeg,lastLeg,...(boundaryAfterLeg===undefined?{}:{boundaryAfterLeg})})),
    notes:['Every component leg is queried in this batch; this is not a selective retry or reuse plan.','Only endpoints are submitted; GPX shape points, cues and supplies are not additional queries.','Mandatory boundaries affect query count only; their evidence and all essential waypoints still require assembly review.','Actual attempts may be fewer after a failure; automatic retries remain zero.']};
}

function redact(value,key){
  let text=String(value);
  for(const token of new Set([key,encodeURIComponent(key),JSON.stringify(key).slice(1,-1)]))if(token)text=text.split(token).join('[REDACTED]');
  return text;
}

export async function fetchBicycleResponse(leg,key,request=fetch,context={},onEvidence=async()=>{}){
  const evidence={...context,start:leg.start,end:leg.end,requestedAt:new Date().toISOString(),httpStatus:null,bodyFormat:'unavailable'};
  let body,rawText;
  try{
    const args=[requestUrl(leg,key),{signal:AbortSignal.timeout(20000)}];
    const response=await (request[REQUEST_STARTED]
      ?request[REQUEST_STARTED](timestamp=>{evidence.requestedAt=timestamp},...args)
      :request(...args));
    evidence.httpStatus=response.status??null;evidence.httpOk=response.ok;
    rawText=typeof response.text==='function'?await response.text():JSON.stringify(await response.json());
    const safe=redact(rawText,key);
    evidence.rawText=safe;evidence.keyRedacted=safe!==rawText;
    try{body=JSON.parse(safe);evidence.body=body;evidence.bodyFormat='json';}catch{evidence.bodyFormat='text';}
    if(!response.ok)throw Error('AMap HTTP status '+response.status);
    if(evidence.bodyFormat!=='json')throw Error('AMap response is not JSON');
    parseAmapBicycleV5(body);
    evidence.accepted=true;
  }catch(error){
    evidence.accepted=false;evidence.error=redact(error.message,key);
    await onEvidence(evidence);
    throw Error(evidence.error);
  }
  await onEvidence(evidence);
  return body;
}

export async function fetchNavigationGroups(manifest,key,legResponses,request=fetch,onEvidence){
  if(!manifest.navigationGroups)return [];
  const out=[];
  for(const g of navigationSpans(manifest)){
    if(g.firstLeg===g.lastLeg){out.push(legResponses[g.firstLeg-1]);continue;}
    const body=await fetchBicycleResponse({start:manifest.legs[g.firstLeg-1].start,end:manifest.legs[g.lastLeg-1].end},key,request,{stage:'navigation-group',index:out.length+1},onEvidence);out.push(body);
  }
  return out;
}

export function requestUrl(leg,key){
  const valid=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180;
  if(!valid(leg?.start)||!valid(leg?.end)||!key)throw Error('Invalid start, end or AMap key');
  const pair=p=>{const q=gcj(p);return q[1].toFixed(6)+','+q[0].toFixed(6)};
  const url=new URL('https://restapi.amap.com/v5/direction/bicycling');
  url.searchParams.set('origin',pair(leg.start));
  url.searchParams.set('destination',pair(leg.end));
  url.searchParams.set('show_fields','polyline');
  url.searchParams.set('key',key);
  return url;
}

export async function fetchLegs(manifest,key,request=fetch,onEvidence){
  if(!Array.isArray(manifest?.legs)||!manifest.legs.length)throw Error('Manifest has no legs');
  const responses=[];
  for(const leg of manifest.legs){
    const body=await fetchBicycleResponse(leg,key,request,{stage:'leg',index:responses.length+1},onEvidence);
    responses.push(body);
  }
  return responses;
}

export async function fetchRemovalTests(manifest,key,request=fetch,onEvidence){
  const responses=[];
  for(const query of removalQueries(manifest)){
    const body=await fetchBicycleResponse(query,key,request,{stage:query.stage,index:query.index,boundaryAfterLeg:query.boundaryAfterLeg},onEvidence);
    responses.push({boundaryAfterLeg:query.boundaryAfterLeg,body});
  }
  return responses;
}

export async function collectToDirectory(manifest,key,outDir,request=fetch,options={}){
  const maxRequests=options?.maxRequests;
  if(!Number.isSafeInteger(maxRequests)||maxRequests<0)throw Error('collectToDirectory requires explicit maxRequests as a non-negative safe integer');
  manifest=structuredClone(manifest);
  const plan=planCollection(manifest,{maxRequests}),summary=summarizeCollectionPlan(plan);
  if(plan.withinBudget===false)throw Error('Request budget exceeded: planned '+plan.requests.length+', maximum '+plan.maxRequests+'; collection not started');
  const resolved=path.resolve(outDir);
  await fs.mkdir(resolved,{recursive:true});
  if((await fs.readdir(resolved)).length)throw Error('Use a new empty output directory; preserve previous captures');
  await fs.writeFile(path.join(resolved,'collection-plan.json'),JSON.stringify(summary,null,2));
  let count=0,accepted=0;const dates=new Map();
  const save=async evidence=>{
    count++;if(evidence.accepted){accepted++;dates.set(evidence.stage+':'+evidence.index,evidence.requestedAt);}
    await fs.writeFile(path.join(resolved,'request-'+String(count).padStart(3,'0')+'.json'),JSON.stringify(evidence,null,2));
    if(evidence.accepted)await fs.writeFile(path.join(resolved,evidence.stage+'-'+String(evidence.index).padStart(2,'0')+'.json'),JSON.stringify(evidence.body,null,2));
  };
  let responses,groupResponses,removal;
  try{
    responses=await fetchLegs(manifest,key,request,save);
    groupResponses=await fetchNavigationGroups(manifest,key,responses,request,save);
    removal=await fetchRemovalTests(manifest,key,request,save);
  }catch(error){
    const report={status:'failed',plannedRequests:plan.requests.length,attemptedRequests:count,acceptedResponses:accepted,error:redact(error.message,key),completedAt:new Date().toISOString(),automaticRetries:0};
    await fs.writeFile(path.join(resolved,'collection-status.json'),JSON.stringify(report,null,2));
    throw Error(report.error);
  }
  const saved=buildApiManifest(manifest,removal);
  saved.legs.forEach((leg,i)=>{leg.queriedAt=dates.get('leg:'+(i+1));});
  saved.navigationGroups?.forEach((g,i)=>{g.queriedAt=g.firstLeg===g.lastLeg?saved.legs[g.firstLeg-1].queriedAt:dates.get('navigation-group:'+(i+1));});
  saved.removalTests.forEach(x=>{x.queriedAt=dates.get('merge-after:'+x.boundaryAfterLeg);});
  for(let i=0;i<groupResponses.length;i++)await fs.writeFile(path.join(resolved,saved.navigationGroups[i].responseFile),JSON.stringify(groupResponses[i],null,2));
  await fs.writeFile(path.join(resolved,'manifest-with-responses.json'),JSON.stringify(saved,null,2));
  const report={status:'captured-not-reviewed',plannedRequests:plan.requests.length,attemptedRequests:count,acceptedResponses:accepted,responses:responses.length,deletionTests:removal.length,completedAt:new Date().toISOString(),automaticRetries:0,manifest:path.join(resolved,'manifest-with-responses.json')};
  await fs.writeFile(path.join(resolved,'collection-status.json'),JSON.stringify(report,null,2));
  return report;
}

async function main(args){
  if(args.length===1&&args[0]==='--help'){console.log('Local only: --manifest FILE --dry-run [--max-requests N]. Authorized collection: --manifest FILE --out-dir NEW_DIR --max-requests N --send-segment-endpoints-to-amap [--interval-ms MS]. N is an explicit non-negative request cap, not a fee estimate or authorization.');return;}
  const flags=new Set(['--dry-run','--send-segment-endpoints-to-amap']),values=new Set(['--manifest','--out-dir','--max-requests','--interval-ms']),v={};
  for(let i=0;i<args.length;i++){
    const k=args[i];if(Object.hasOwn(v,k)||!flags.has(k)&&!values.has(k))throw Error('Unknown or duplicate CLI option');
    if(flags.has(k))v[k]=true;else{if(args[i+1]===undefined||args[i+1].startsWith('--'))throw Error('Missing CLI option value');v[k]=args[++i];}
  }
  if(!v['--manifest'])throw Error('Missing --manifest FILE');
  const raw=v['--max-requests'];
  if(raw!==undefined&&!/^(0|[1-9]\d*)$/.test(raw))throw Error('--max-requests must be a non-negative integer');
  const maxRequests=raw===undefined?undefined:Number(raw),manifest=JSON.parse(await fs.readFile(v['--manifest'],'utf8'));
  const plan=planCollection(manifest,{maxRequests});
  if(v['--dry-run']){
    if(v['--send-segment-endpoints-to-amap']||v['--out-dir']||v['--interval-ms'])throw Error('Dry run cannot include collection options');
    console.log(JSON.stringify(summarizeCollectionPlan(plan)));if(plan.withinBudget===false)process.exitCode=1;return;
  }
  if(!v['--out-dir']||!v['--send-segment-endpoints-to-amap']||maxRequests===undefined)throw Error('Authorized collection requires --out-dir DIR --max-requests N --send-segment-endpoints-to-amap');
  if(plan.withinBudget===false)throw Error('Request budget exceeded: planned '+plan.requests.length+', maximum '+maxRequests+'; collection not started');
  const key=process.env.AMAP_WEB_SERVICE_KEY;
  if(!key)throw Error('AMAP_WEB_SERVICE_KEY is not configured');
  const request=createPacedRequest(fetch,{intervalMs:v['--interval-ms']===undefined?400:Number(v['--interval-ms'])});
  console.log(JSON.stringify(await collectToDirectory(manifest,key,v['--out-dir'],request,{maxRequests})));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1});
}
