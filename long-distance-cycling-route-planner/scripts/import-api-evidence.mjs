import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseGpx,gcjToWgs,metres} from './diagnose-osm-route.mjs';
import {parseAmapBicycleV5} from './assemble-amap-map.mjs';
import {orderedRouteCheck} from './ordered-route-check.mjs';
import {isEvidenceDate} from './evidence-dates.mjs';

const valid=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180;
function endpoint(text){
 if(typeof text!=='string')throw Error('Original AMap route origin/destination missing');
 const pair=text.split(',').map(Number);if(pair.length!==2||!valid([pair[1],pair[0]]))throw Error('Invalid AMap endpoint');
 return gcjToWgs([pair[1],pair[0]]);
}
function nearestIndex(point,points){let index=0,distance=Infinity;for(let i=0;i<points.length;i++){const d=metres(point,points[i]);if(d<distance){index=i;distance=d}}return {index,distance}}
function matchMainOccurrences(points,records,topology){
 const closedAlias=topology==='loop'&&metres(points[0],points.at(-1))<.01;
 const inputs=records.map((record,i)=>{
  const actual=parseAmapBicycleV5(record).points,start=endpoint(record.route.origin),end=endpoint(record.route.destination);
  const a=nearestIndex(start,points),b=nearestIndex(end,points);
  const type=i===0&&a.distance>150?'outbound':i===records.length-1&&b.distance>150?'return':'main';
  const ties=(p,best)=>points.map((q,index)=>({index,distance:metres(p,q)})).filter(q=>q.distance<=best.distance+1&&!(closedAlias&&q.index===points.length-1)&&!(q.index>0&&metres(points[q.index-1],points[q.index])<.01));
  return {i,actual,type,a,b,starts:ties(start,a),ends:ties(end,b)};
 });
 const main=inputs.filter(x=>x.type==='main'),n=points.length,memo=new Map(),scores=new Map();
 const spans=(a,b)=>b<n?[points.slice(a,b+1)]:[points.slice(a),points.slice(0,b-n+1)];
 function solve(k,cursor){
  if(k===main.length)return [{score:0,matches:[]}];
  const key=k+':'+cursor;if(memo.has(key))return memo.get(key);
  const item=main[k],candidates=[];
  if(item.starts.length*item.ends.length>4096)throw Error('Ambiguous dense GPX occurrence matching; select a smaller explicit span');
  for(const a of item.starts)for(const b of item.ends){
   const offset=cursor===null?0:topology==='loop'?Math.max(0,Math.ceil((cursor-a.index)/n))*n:0;
   const startProgress=a.index+offset;if(cursor!==null&&startProgress!==cursor)continue;
   const endOptions=[b.index];if(topology==='loop'&&b.index<=a.index)endOptions.push(b.index+n);
   for(const endIndex of endOptions){
    if(endIndex<a.index)continue;
    const pieces=spans(a.index,endIndex).filter(x=>x.length>=2);if(!pieces.length)continue;
    // Score each original continuous span separately; never invent the GPX gap.
    const length=line=>line.slice(1).reduce((s,p,j)=>s+metres(line[j],p),0);
    const longest=pieces.reduce((x,y)=>length(x)>=length(y)?x:y),scoreKey=item.i+':'+a.index+':'+endIndex;
    let score=scores.get(scoreKey);
    if(score===undefined){score=orderedRouteCheck(longest,item.actual).orderedDistanceMetres+a.distance+b.distance;scores.set(scoreKey,score);}
    for(const tail of solve(k+1,endIndex+offset))candidates.push({score:score+tail.score,matches:[{i:item.i,a,b,spans:pieces},...tail.matches]});
   }
  }
  candidates.sort((a,b)=>a.score-b.score);const result=candidates.slice(0,2);memo.set(key,result);return result;
 }
 const solutions=solve(0,null);
 if(!solutions.length)throw Error('Captured main route order reverses an open reference or has no compatible GPX occurrence');
 if(solutions[1]&&Math.abs(solutions[1].score-solutions[0].score)<=1)throw Error('Ambiguous repeated GPX occurrences; original geometry/order cannot distinguish the reference span');
 const matches=new Map(solutions[0].matches.map(x=>[x.i,x]));
 return inputs.map(x=>({...x,...matches.get(x.i)}));
}
export function importGroups(legs,records,componentRecords){
 const actual=records.map(r=>({start:endpoint(r.route.origin),end:endpoint(r.route.destination),points:parseAmapBicycleV5(r).points}));
 if(componentRecords&&componentRecords.length!==legs.length)throw Error('All original component captures are required for geometry matching');
 const components=componentRecords?.map(r=>parseAmapBicycleV5(r).points),memo=new Map();
 function solve(group,cursor){
  if(group===actual.length)return cursor===legs.length?{score:0,ranges:[],ambiguous:false}:null;
  const key=group+','+cursor;if(memo.has(key))return memo.get(key);
  const a=actual[group];if(!legs[cursor]||metres(a.start,legs[cursor].start)>50)return null;
  const candidates=[];
  for(let last=cursor;last<legs.length;last++){
   if(metres(a.end,legs[last].end)>50)continue;
   const tail=solve(group+1,last+1);if(!tail)continue;
   const reference=components?.slice(cursor,last+1).flatMap((p,j)=>j?p.slice(1):p);
   const score=reference?orderedRouteCheck(reference,a.points).orderedDistanceMetres:0;
   candidates.push({score:score+tail.score,ranges:[[cursor,last],...tail.ranges],ambiguous:tail.ambiguous});
  }
  candidates.sort((a,b)=>a.score-b.score);
  const result=candidates[0]||null;
  if(result&&candidates[1]&&Math.abs(candidates[1].score-result.score)<=1)result.ambiguous=true;
  memo.set(key,result);return result;
 }
 const solution=solve(0,0);
 if(!solution)throw Error('Captured groups do not cover all components in order');
 if(solution.ambiguous)throw Error('Ambiguous repeated group endpoints; provide original component geometry or an explicitly reviewed group plan');
 return solution.ranges.map(([first,last])=>{
  const mixed=legs.slice(first,last+1).some(x=>x.type==='main')&&legs[last].type==='return';
  return {firstLeg:first+1,lastLeg:last+1,name:(mixed?'沿主线后返程 → ':'')+(legs[last].endpointName||legs[last].name||'道路终点待核对'),reason:'原始组与组成几何按完整顺序匹配；内部边界不切换，仍须道路和删除核查',evidenceType:'amap-api-v5'};
 });
}
export function importEvidence(points,records,options){
 if(!points?.length||!records?.length||!valid(options?.start)||!valid(options?.end))throw Error('Need GPX points, original responses and actual WGS-84 start/end');
 if(!['loop','open'].includes(options.topology)||!['forward','reverse'].includes(options.direction))throw Error('Explicit topology and direction required; do not infer a loop from nearby endpoints');
 if(options.queriedAt!==undefined&&options.queriedAt!==null&&!isEvidenceDate(options.queriedAt))throw Error('Original API query date required');
 if(options.legQueryDates!==undefined&&(!Array.isArray(options.legQueryDates)||options.legQueryDates.length!==records.length||options.legQueryDates.some(x=>!isEvidenceDate(x))))throw Error('Every original leg query date required');
 if(!isEvidenceDate(options.queriedAt)&&!options.legQueryDates)throw Error('Original API query date required; use dated capture records or --queried-at for genuinely same-date legacy captures');
 const days=options.days??1;if(!Number.isInteger(days)||days<1)throw Error('days must be a positive integer');
 const pathPoints=options.direction==='reverse'?[...points].reverse():points;
 const toOriginal=i=>options.direction==='reverse'?points.length-1-i:i;
 const matched=matchMainOccurrences(pathPoints,records,options.topology);
 const legs=records.map((record,i)=>{
  const r=parseAmapBicycleV5(record),start=endpoint(record.route.origin),end=endpoint(record.route.destination);
  if(i===0&&metres(start,options.start)>50)throw Error('First captured request differs from actual start');
  if(i===records.length-1&&metres(end,options.end)>50)throw Error('Last captured request differs from actual end');
  const {a,b,type}=matched[i];
  const names=record.route.paths[0].steps.map(x=>x.road_name).filter(Boolean);
  const lastStep=record.route.paths[0].steps.at(-1);
  const endName=i===records.length-1?options.endName||(metres(options.start,options.end)<=50?options.startName||'实际起点':'实际终点'):lastStep.road_name?lastStep.road_name+'附近':'道路终点（名称待核对）';
  const leg={type,name:'高德分段'+String(i+1).padStart(2,'0')+' · '+endName,endpointName:endName,start,end,
   reason:'原始服务留存的候选端点；必须按当前删除响应与道路结构复核，不能视为已批准导航',
   evidenceType:'amap-api-v5',...(options.legQueryDates?{queriedAt:options.legQueryDates[i]}:{}),capturedDistanceKm:r.distanceKm,roadNames:[...new Set(names)],
   nearestGpx:{startOriginalIndex:toOriginal(a.index),endOriginalIndex:toOriginal(b.index),startDistanceMetres:a.distance,endDistanceMetres:b.distance}};
  if(type==='main'){
   if(a.distance>150||b.distance>150)throw Error('Main endpoint is not close to GPX; explicitly plan its reference instead of inventing one');
   const spans=matched[i].spans;
   // Keep disconnected original spans separate. Never insert a tail/start chord.
   leg.referenceSpans=spans.map(x=>({points:x,source:'original-gpx'}));
   const length=line=>line.slice(1).reduce((sum,p,i)=>sum+metres(line[i],p),0);
   leg.referencePoints=spans.reduce((a,b)=>length(a)>=length(b)?a:b);
   leg.referenceSource='original-gpx';
   leg.referenceScope=spans.length>1?'partial-original-span; original tail/start connector must be reviewed separately':'contiguous-original-span';
   if(spans.length>1)leg.referenceGapMetres=metres(pathPoints.at(-1),pathPoints[0]);
  }
  return leg;
 });
 for(let i=1;i<legs.length;i++)if(metres(legs[i-1].end,legs[i].start)>50)throw Error('Captured requests are not contiguous');
 const outbound=legs.find(x=>x.type==='outbound');
 if(options.topology==='loop'&&outbound){for(const leg of legs)if(leg.type==='return'&&leg.nearestGpx.startOriginalIndex!==outbound.nearestGpx.endOriginalIndex){
  leg.compositionScope='possible-main-tail-and-return';leg.name+='（主线尾段/返程待拆分）';
 }}
 return {title:options.title||'原GPX与高德方案 · 待审核',subtitle:(options.startName||'实际起点')+' · '+days+'天 · 原始服务响应重建',
  alignmentMode:'gpx-guided',topology:options.topology,direction:options.direction,actualStart:options.start,actualEnd:options.end,days,queriedAt:options.queriedAt,
  originalGpx:{name:options.gpxName||'原始GPX完整参考',points},legs,cues:[{name:'停车操作与出发前检查',kind:'safety',note:'不要骑行中操作手机；检查车辆、灯具与天气，遵守现场交通和禁行标志。'}],supplies:[],turnCandidates:[],
  planningNotes:['参考区间由最近原始顶点提取，是待道路审核的候选，不是入口或路权确认。','跨原GPX首尾缺口使用独立referenceSpans；主对比只取较长原段，不能把部分覆盖指标当整段偏离。','最后导航段可能含主线尾段和返程；不得把该段公里数全部称为纯返程，也不得按几何比例拆成精确导航距离。'],
  review:{routeAndRoadsChecked:false,navDeletionChecked:false,accessChecked:false,checkedAt:'',evidence:''}};
}

export function restoreCaptureDates(manifest,capture){
 for(const kind of ['legs','navigationGroups','removalTests']){
  const dates=new Map();
  for(const item of capture?.[kind]||[]){
   if(item.queriedAt===undefined)continue;
   if(!isEvidenceDate(item.queriedAt))throw Error('Invalid original capture query date');
   if(typeof item.responseFile!=='string')throw Error('Dated capture needs its original response filename');
   const file=path.basename(item.responseFile);
   if(dates.has(file)&&dates.get(file)!==item.queriedAt)throw Error('Ambiguous query dates for the same capture filename');
   dates.set(file,item.queriedAt);
  }
  for(const item of manifest[kind]||[]){const date=dates.get(path.basename(item.responseFile));if(date)item.queriedAt=date;}
 }
 return manifest;
}

async function main(args){
 if(args.length===1&&args[0]==='--help'){console.log('Use --gpx INPUT.gpx --responses RAW_DIR --start LAT,LON --end LAT,LON --topology loop|open --direction forward|reverse --out-dir NEW_JOB [--queried-at ORIGINAL_DATE]. Coordinates WGS-84. Date flag optional only when manifest-with-responses.json dates every leg; never use generation/file dates. Optional --days --title --start-name --end-name. No network or road approval.');return;}
 const allowed=new Set(['--gpx','--responses','--start','--end','--topology','--direction','--queried-at','--out-dir','--days','--title','--start-name','--end-name']),values={};
 for(let i=0;i<args.length;i+=2){if(!allowed.has(args[i])||!args[i+1]||Object.hasOwn(values,args[i]))throw Error('Unknown, repeated or missing CLI option; read --help');values[args[i]]=args[i+1];}
 const get=n=>values[n];
 for(const name of ['--gpx','--responses','--start','--end','--topology','--direction','--out-dir'])if(!get(name))throw Error('Missing '+name+'; coordinates must be WGS-84 LAT,LON; read --help');
 const source=path.resolve(get('--responses')),dest=path.resolve(get('--out-dir'));
 const files=(await fs.readdir(source)).filter(x=>/^leg-\d+\.json$/.test(x)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
 if(!files.length||files.some((x,i)=>Number(x.match(/\d+/)[0])!==i+1))throw Error('Need contiguous leg-01.json ... original captures');
 const records=await Promise.all(files.map(x=>fs.readFile(path.join(source,x),'utf8').then(JSON.parse)));
 let captureDates;try{captureDates=JSON.parse(await fs.readFile(path.join(source,'manifest-with-responses.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const dated=restoreCaptureDates({legs:files.map(responseFile=>({responseFile}))},captureDates).legs.map(x=>x.queriedAt);
 if(!get('--queried-at')&&dated.some(x=>!isEvidenceDate(x)))throw Error('Every leg needs its original query date; supply complete dated captures or a known same-date --queried-at. Never substitute today.');
 const points=parseGpx(await fs.readFile(get('--gpx'),'utf8'));
 const manifest=importEvidence(points,records,{start:get('--start').split(',').map(Number),end:get('--end').split(',').map(Number),topology:get('--topology'),direction:get('--direction'),queriedAt:get('--queried-at'),...(dated.every(isEvidenceDate)?{legQueryDates:dated}:{}),days:get('--days')?Number(get('--days')):1,title:get('--title'),startName:get('--start-name'),endName:get('--end-name'),gpxName:path.basename(get('--gpx'))});
 const captures=path.join(dest,'captures');await fs.mkdir(captures,{recursive:true});
 for(let i=0;i<files.length;i++){const file='leg-'+String(i+1).padStart(2,'0')+'.json';await fs.copyFile(path.join(source,files[i]),path.join(captures,file));manifest.legs[i].responseFile='captures/'+file;}
 manifest.removalTests=[];
 const groupFiles=(await fs.readdir(source)).filter(x=>/^navigation-group-\d+\.json$/.test(x)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
 if(groupFiles.length){
  if(groupFiles.some((x,i)=>Number(x.match(/\d+/)[0])!==i+1))throw Error('Captured group files must be contiguous');
  const groups=importGroups(manifest.legs,await Promise.all(groupFiles.map(x=>fs.readFile(path.join(source,x),'utf8').then(JSON.parse))),records);
  for(let i=0;i<groups.length;i++){const file='navigation-group-'+String(i+1).padStart(2,'0')+'.json';await fs.copyFile(path.join(source,groupFiles[i]),path.join(captures,file));groups[i].responseFile='captures/'+file;}manifest.navigationGroups=groups;
 }
 for(let i=1;i<files.length;i++){
  const file='merge-after-'+String(i).padStart(2,'0')+'.json';
  try{const record=JSON.parse(await fs.readFile(path.join(source,file),'utf8'));parseAmapBicycleV5(record);await fs.copyFile(path.join(source,file),path.join(captures,file));manifest.removalTests.push({boundaryAfterLeg:i,evidenceType:'amap-api-v5',responseFile:'captures/'+file});}
  catch(e){if(e.code!=='ENOENT')throw e;}
 }
 restoreCaptureDates(manifest,captureDates);
 await fs.writeFile(path.join(dest,'manifest.json'),JSON.stringify(manifest,null,2));
 console.log(JSON.stringify({status:'unreviewed',legs:files.length,originalPoints:points.length,deletionCaptures:manifest.removalTests.length,manifest:path.join(dest,'manifest.json'),networkCalls:0}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1});
