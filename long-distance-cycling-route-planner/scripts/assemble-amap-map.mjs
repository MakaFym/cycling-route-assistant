import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {gcjToWgs,metres} from './diagnose-osm-route.mjs';
import {orderedRouteCheck} from './ordered-route-check.mjs';
import {parseWebRouteRecord} from './amap-web-evidence.mjs';
import {reviewStatus} from './review-status.mjs';
import {isEvidenceDate,evidenceDay} from './evidence-dates.mjs';
import {createHash} from 'node:crypto';

function validPoint(p){return Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180}
function polyline(text){
  if(typeof text!=='string')throw Error('AMap step polyline missing; request show_fields=polyline');
  const points=text.split(';').filter(Boolean).map(pair=>{
    const [lon,lat]=pair.split(',').map(Number),p=[lat,lon];
    if(!validPoint(p))throw Error('Invalid AMap polyline coordinate');
    return gcjToWgs(p);
  });
  if(points.length<2)throw Error('AMap step polyline has fewer than two points');
  return points;
}

export function parseAmapBicycleV5(payload){
  if(String(payload?.status)!=='1'||String(payload?.infocode)!=='10000')throw Error('AMap bicycling response failed: '+String(payload?.info||payload?.infocode||'unknown'));
  const route=payload.route?.paths?.[0];
  const distanceMetres=Number(route?.distance),steps=route?.steps;
  if(!Number.isFinite(distanceMetres)||distanceMetres<=0||!Array.isArray(steps)||!steps.length)throw Error('AMap bicycling path or distance missing');
  const points=[];
  for(const step of steps){
    const line=polyline(step.polyline);
    if(points.length&&metres(points.at(-1),line[0])>1)throw Error('AMap internal step geometry gap over 1 m; missing road geometry cannot be bridged with a straight line');
    for(const p of line)if(!points.length||metres(points.at(-1),p)>.2)points.push(p);
  }
  if(points.length<2)throw Error('AMap bicycling path has no usable geometry');
  return {distanceKm:distanceMetres/1000,points,stepCount:steps.length};
}

function distanceToSegment(p,a,b){
  return projectToSegment(p,a,b).distance;
}
function projectToSegment(p,a,b){
  const sx=111320*Math.cos(p[0]*Math.PI/180),sy=110540;
  const x=(p[1]-a[1])*sx,y=(p[0]-a[0])*sy,dx=(b[1]-a[1])*sx,dy=(b[0]-a[0])*sy;
  const t=Math.max(0,Math.min(1,(x*dx+y*dy)/(dx*dx+dy*dy||1)));
  return {distance:Math.hypot(x-t*dx,y-t*dy),t};
}
function nearestOnLine(p,line){let best=Infinity;for(let i=1;i<line.length;i++)best=Math.min(best,distanceToSegment(p,line[i-1],line[i]));return best}
function p95(values){const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(.95*(sorted.length-1))]}

function uniformSamples(line,spacing=20){
  const out=[line[0]];
  for(let i=1;i<line.length;i++){
    const distance=metres(line[i-1],line[i]),count=Math.max(1,Math.ceil(distance/spacing));
    for(let j=1;j<=count;j++)out.push([line[i-1][0]+(line[i][0]-line[i-1][0])*j/count,line[i-1][1]+(line[i][1]-line[i-1][1])*j/count]);
  }
  return out;
}
function lineKm(line){return line.slice(1).reduce((sum,p,i)=>sum+metres(line[i],p),0)/1000}
function nearestOnLines(point,lines){let best=Infinity;for(const line of lines)best=Math.min(best,nearestOnLine(point,line));return best}
function longestContinuousDeviationKm(sourceLines,targetLines,limit){
  let longest=0,current=0,previous=null;
  for(const line of sourceLines){
    const sampled=uniformSamples(line);
    if(previous&&metres(previous,sampled[0])>100)current=0;
    for(let i=0;i<sampled.length;i++){
      const point=sampled[i],far=nearestOnLines(point,targetLines)>limit;
      if(i===0){
        if(!far)current=0;
      }else{
        const previousFar=nearestOnLines(sampled[i-1],targetLines)>limit;
        if(far&&previousFar){current+=metres(sampled[i-1],point);longest=Math.max(longest,current)}else if(!far)current=0;
      }
    }
    previous=sampled.at(-1);
  }
  return Number((longest/1000).toFixed(3));
}
function directionalCoverage(sourceLines,targetLines){
  const distances=sourceLines.flatMap(line=>uniformSamples(line).map(point=>nearestOnLines(point,targetLines))).sort((a,b)=>a-b);
  const percent=limit=>Number((100*distances.filter(x=>x<=limit).length/distances.length).toFixed(1));
  const quantile=value=>Number(distances[Math.floor(value*(distances.length-1))].toFixed(1));
  return {samples:distances.length,within50mPct:percent(50),within100mPct:percent(100),within200mPct:percent(200),within500mPct:percent(500),medianMetres:quantile(.5),p95Metres:quantile(.95),maxMetres:Number(distances.at(-1).toFixed(1)),longestBeyond200mKm:longestContinuousDeviationKm(sourceLines,targetLines,200),longestBeyond500mKm:longestContinuousDeviationKm(sourceLines,targetLines,500)};
}
export function routeCoverage(referenceLines,actualLines){
  if(!Array.isArray(referenceLines)||!referenceLines.length||!referenceLines.every(line=>Array.isArray(line)&&line.length>=2&&line.every(validPoint)))throw Error('Route coverage needs valid reference lines');
  if(!Array.isArray(actualLines)||!actualLines.length||!actualLines.every(line=>Array.isArray(line)&&line.length>=2&&line.every(validPoint)))throw Error('Route coverage needs valid actual lines');
  return {basis:'Uniform approximately 20 m samples; nearest polyline distance; geometry-only and direction-invariant',referenceKm:Number(referenceLines.reduce((s,line)=>s+lineKm(line),0).toFixed(3)),actualGeometryKm:Number(actualLines.reduce((s,line)=>s+lineKm(line),0).toFixed(3)),referenceCoveredByAmap:directionalCoverage(referenceLines,actualLines),amapCloseToReference:directionalCoverage(actualLines,referenceLines)};
}

function fidelity(reference,actual){
  if(!Array.isArray(reference)||reference.length<2||!reference.every(validPoint))throw Error('Reference points must be WGS-84 [lat,lon] pairs');
  const d=[...reference.map(p=>nearestOnLine(p,actual)),...actual.map(p=>nearestOnLine(p,reference))];
  const referenceKm=reference.slice(1).reduce((s,p,i)=>s+metres(reference[i],p),0)/1000;
  const actualKm=actual.slice(1).reduce((s,p,i)=>s+metres(actual[i],p),0)/1000;
  return {p95Metres:p95(d),maxMetres:Math.max(...d),referenceGeometryKm:referenceKm,comparedGeometryKm:actualKm,ratio:actualKm/referenceKm,
    ...orderedRouteCheck(reference,actual)};
}

function parseEvidence(payload,leg){
  if(leg.evidenceType==='amap-mobile-web')return parseWebRouteRecord(payload,leg);
  if(leg.evidenceType&&leg.evidenceType!=='amap-api-v5')throw Error('Unknown route evidence type');
  return parseAmapBicycleV5(payload);
}

function queryDate(item,manifest,errors,label){
  const date=item.queriedAt===undefined?manifest.queriedAt:item.queriedAt;
  if(!isEvidenceDate(date))errors.push(label+' query date missing or invalid');
  return date;
}
function queryDays(items){
  return [...new Set(items.map(p=>p.distanceEvidence?.queriedAt).filter(isEvidenceDate).map(evidenceDay))].sort();
}
function essentialIssues(points,items,label){
  if(!Array.isArray(items))return [label+' has invalid essential waypoint list'];
  const issues=[];let cursor=0;
  for(const x of items){
    if(typeof x?.name!=='string'||!x.name.trim()||!validPoint(x.point)){issues.push(label+' has invalid essential waypoint');continue;}
    let progress=null;
    for(let j=1;j<points.length;j++){
      const q=projectToSegment(x.point,points[j-1],points[j]),position=j-1+q.t;
      if(q.distance<=120&&position+1e-9>=cursor){progress=position;break;}
    }
    if(progress===null)issues.push(label+' misses ordered essential waypoint: '+x.name);else cursor=progress;
  }
  return issues;
}
const spanEssentials=(manifest,first,last)=>manifest.legs.slice(first-1,last).flatMap(x=>x.essentialWaypoints??[]);

export function assemble(manifest,responses,removalResponses=[],groupResponses=[]){
  const errors=[],warnings=[],parts=[],navSegments=[],fidelityReports=[],removalReports=[],mainCoveragePairs=[];
  const declaredGapBetween=(from,to)=>Array.isArray(manifest.routeEngineGaps)&&manifest.routeEngineGaps.some(g=>validPoint(g?.start)&&validPoint(g?.end)&&metres(g.start,from)<=50&&metres(g.end,to)<=50);
  let groupsAccepted=false;
  const alignmentMode=manifest.alignmentMode||'gpx-guided';
  if(!['gpx-guided','strict'].includes(alignmentMode))throw Error('Unknown alignment mode');
  if(!Array.isArray(manifest?.legs)||!manifest.legs.length)throw Error('Manifest needs ordered legs');
  if(!validPoint(manifest.actualStart)||!validPoint(manifest.actualEnd))throw Error('Manifest needs actualStart and actualEnd WGS-84 coordinates');
  if(responses.length!==manifest.legs.length)throw Error('One AMap response is required per leg');
  for(let i=0;i<manifest.legs.length;i++){
    const leg=manifest.legs[i];
    if(leg.compositionScope==='possible-main-tail-and-return')errors.push('Composition leg '+(i+1)+' may mix GPX tail and return; obtain independent component distances and use a navigation group');
    if(leg.mandatoryKind==='diagnostic_anchor')errors.push('Leg '+(i+1)+' uses a diagnostic-only anchor; merge, delete or replace it before final delivery');
    if(!['outbound','main','return'].includes(leg.type)||!leg.name||!leg.reason||!validPoint(leg.start)||!validPoint(leg.end))throw Error('Invalid leg metadata at index '+i);
    let result;
    try{result=parseEvidence(responses[i],leg)}catch(e){errors.push('Leg '+(i+1)+': '+e.message);continue}
    for(const issue of result.issues||[])errors.push('Leg '+(i+1)+': '+issue);
    if(metres(result.points[0],leg.start)>120||metres(result.points.at(-1),leg.end)>120)errors.push('Leg '+(i+1)+': Provided route geometry endpoints differ from declared endpoints by over 120 m');
    if(i===0&&metres(leg.start,manifest.actualStart)>50)errors.push('First leg does not start at actualStart');
    if(i===manifest.legs.length-1&&metres(leg.end,manifest.actualEnd)>50)errors.push('Last leg does not end at actualEnd');
    if(i>0&&validPoint(manifest.legs[i-1]?.end)&&metres(manifest.legs[i-1].end,leg.start)>50&&!declaredGapBetween(manifest.legs[i-1].end,leg.start))errors.push('Leg '+i+' to '+(i+1)+' endpoint gap over 50 m');
    if(parts.length&&metres(parts.at(-1).points.at(-1),result.points[0])>100&&!declaredGapBetween(manifest.legs[i-1].end,leg.start))errors.push('Leg '+i+' to '+(i+1)+' Route geometry gap over 100 m');
    if(leg.type==='main'){
      if(!leg.referencePoints){warnings.push('Main leg '+(i+1)+' has no independently checked fixed-route reference');errors.push('Main leg '+(i+1)+' lacks fixed-route reference')}
      else{
        try{
          const f=fidelity(leg.referencePoints,result.points);
          if(leg.referenceSpans){
            if(!Array.isArray(leg.referenceSpans)||!leg.referenceSpans.length||!leg.referenceSpans.every(x=>Array.isArray(x.points)&&x.points.length>=2&&x.points.every(validPoint)))throw Error('Invalid disconnected GPX reference spans');
            if(!leg.referenceSpans.some(x=>JSON.stringify(x.points)===JSON.stringify(leg.referencePoints)))throw Error('Reference points must match one contiguous reference span; stale span metadata or concatenated GPX spans require rebuilding the reference');
          }
          const original=manifest.originalGpx?.points;
          if(leg.referenceSource==='original-gpx'&&Array.isArray(original)&&original.length>2&&original.every(validPoint)&&metres(original[0],original.at(-1))>100){
            const index=new Map();original.forEach((p,j)=>{const key=p.join(',');if(!index.has(key))index.set(key,[]);index.get(key).push(j);});
            const occurrences=leg.referencePoints.map(p=>index.get(p.join(',')));
            if(occurrences.every(Array.isArray)){
              const monotone=direction=>{let cursor=direction>0?-1:original.length;
                for(const list of occurrences){const next=direction>0?list.find(x=>x>=cursor):[...list].reverse().find(x=>x<=cursor);if(next===undefined)return false;cursor=next;}return true;};
              if(!monotone(1)&&!monotone(-1))throw Error('Flat original-GPX reference crosses a tail/start gap or incompatible occurrence order; use separate spans, not an invented chord');
            }
          }
          const differs=f.p95Metres>150||f.maxMetres>500||f.ratio>1.5||f.ratio<.67||!f.orderCompatible;
          const rv=leg.alignmentReview;
          const reviewed=rv?.checked===true&&isEvidenceDate(rv.checkedAt)&&['same-corridor','accepted-local-reroute'].includes(rv.outcome)&&typeof rv.evidence==='string'&&rv.evidence.trim().length>=20;
          // Lateral reroutes increase footprint and ordered distances together. A large
          // excess of ordered distance screens traversal anomalies even with an offset.
          // This is conservative screening, not a proof that other routes have no loops.
          const suspiciousOrder=f.orderAnomalyScreen||f.endpointReturnAnomaly||(!f.orderCompatible&&f.p95Metres<=50&&f.maxMetres<=100);
          const severeNonorderedMismatch=!f.orderCompatible&&(f.p95Metres>500||f.ratio>1.8||f.ratio<.55);
          let differenceStatus='close-match';
          if(alignmentMode==='strict'){
            if(f.p95Metres>150||f.maxMetres>500||f.ratio>1.5||f.ratio<.67)errors.push('Main leg '+(i+1)+' deviates from fixed reference');
            if(!f.orderCompatible)errors.push('Main leg '+(i+1)+' has incompatible route order or direction');
            if(differs)differenceStatus='strict-mismatch';
          }else if(suspiciousOrder){
            errors.push('Main leg '+(i+1)+' has route order or direction/backtracking anomaly requiring correction; a local reroute review cannot waive this screen');differenceStatus='order-anomaly';
          }else if(severeNonorderedMismatch){
            errors.push('Main leg '+(i+1)+' has a severe nonordered corridor mismatch requiring new route-shaping endpoints; a local reroute review cannot waive it');differenceStatus='severe-nonordered-mismatch';
          }else if(differs){
            warnings.push('Main leg '+(i+1)+' differs from GPX; compare both route layers and easy-to-miss entrances');
            differenceStatus=reviewed?'reviewed-local-difference':'unreviewed-difference';
            if(!reviewed)errors.push('Main leg '+(i+1)+' needs concrete local alignment review, not exact GPX matching');
          }
          fidelityReports.push({leg:i+1,geometrySource:result.geometrySource||'amap-api-v5-polyline',differenceStatus,comparisonScope:leg.referenceScope||'provided-contiguous-reference',referenceSpanCount:leg.referenceSpans?.length||1,alignmentReview:reviewed?rv:null,...f});
        }catch(e){errors.push('Main leg '+(i+1)+': '+e.message)}
      }
    }
    if(leg.essentialWaypoints!=null)errors.push(...essentialIssues(result.points,leg.essentialWaypoints,'Leg '+(i+1)));
    const date=result.distanceEvidence?.queriedAt??queryDate(leg,manifest,errors,'Leg '+(i+1));
    parts.push({type:leg.type,name:leg.name,points:result.points,distanceKm:result.distanceKm,
      basis:result.basis||'AMap Web Service v5 bicycling response; '+(date||'query date missing'),
      distanceEvidence:result.distanceEvidence||{type:'amap-api-v5',queriedAt:date},
      geometrySource:result.geometrySource||'amap-api-v5-polyline',verified:false});
    if(leg.type==='main'&&Array.isArray(leg.referencePoints)&&leg.referencePoints.length>=2&&leg.referencePoints.every(validPoint))mainCoveragePairs.push({reference:leg.referencePoints,actual:result.points});
    navSegments.push({name:leg.name,start:leg.start,end:leg.end,points:result.points,distanceKm:result.distanceKm,reason:leg.reason,basis:parts.at(-1).basis,distanceEvidence:parts.at(-1).distanceEvidence});
  }
  if(!parts.some(p=>p.type==='main'))errors.push('No main route leg');
  if(manifest.navigationGroups!=null){
    try{
      if(!Array.isArray(manifest.navigationGroups)||!manifest.navigationGroups.length||manifest.navigationGroups.length!==groupResponses.length)throw Error('Every navigation group needs its original AMap response');
      let cursor=1;const grouped=[];
      for(let i=0;i<manifest.navigationGroups.length;i++){
        const g=manifest.navigationGroups[i];
        if(!Number.isInteger(g.firstLeg)||!Number.isInteger(g.lastLeg)||g.firstLeg!==cursor||g.lastLeg<g.firstLeg||g.lastLeg>manifest.legs.length||!g.name||!g.reason)throw Error('Groups must partition every component leg exactly once in order');
        const start=manifest.legs[g.firstLeg-1].start,end=manifest.legs[g.lastLeg-1].end;
        const parsed=parseEvidence(groupResponses[i],{...g,start,end});
        if(parsed.issues?.length)throw Error('Group evidence has unresolved geometry review');
        if(metres(parsed.points[0],start)>120||metres(parsed.points.at(-1),end)>120)throw Error('Group endpoints differ from component span');
        const reference=parts.slice(g.firstLeg-1,g.lastLeg).flatMap((p,j)=>j?p.points.slice(1):p.points);
        const f=fidelity(reference,parsed.points);
        if(!f.orderCompatible||f.p95Metres>150||f.maxMetres>500||f.ratio<.67||f.ratio>1.5)throw Error('Group route changes component corridor; replan instead of hiding the change');
        const requiredIssues=essentialIssues(parsed.points,spanEssentials(manifest,g.firstLeg,g.lastLeg),'Navigation group '+(i+1));
        if(g.essentialWaypoints!=null)requiredIssues.push(...essentialIssues(parsed.points,g.essentialWaypoints,'Navigation group '+(i+1)));
        if(requiredIssues.length)throw Error(requiredIssues.join('; '));
        const types=new Set(parts.slice(g.firstLeg-1,g.lastLeg).map(p=>p.type));
        const date=parsed.distanceEvidence?.queriedAt??queryDate({...g,queriedAt:g.queriedAt!==undefined?g.queriedAt:(g.firstLeg===g.lastLeg?manifest.legs[g.firstLeg-1].queriedAt:undefined)},manifest,errors,'Navigation group '+(i+1));
        grouped.push({name:g.name,reason:g.reason,start,end,points:parsed.points,distanceKm:parsed.distanceKm,firstLeg:g.firstLeg,lastLeg:g.lastLeg,type:types.size===1?[...types][0]:'combined',basis:parsed.basis||'原始高德组合导航响应；'+date,distanceEvidence:parsed.distanceEvidence||{type:'amap-api-v5',queriedAt:date},geometrySource:parsed.geometrySource||'amap-api-v5-polyline'});
        cursor=g.lastLeg+1;
      }
      if(cursor!==manifest.legs.length+1)throw Error('Groups omit component legs');
      navSegments.splice(0,navSegments.length,...grouped);
      groupsAccepted=true;
    }catch(e){errors.push('Navigation groups: '+e.message)}
  }
  const totalKm=parts.reduce((sum,p)=>sum+p.distanceKm,0);
  const navigationTotalKm=navSegments.reduce((sum,p)=>sum+p.distanceKm,0);
  const compositionDifferenceKm=Number((navigationTotalKm-totalKm).toFixed(3));
  if(Math.abs(navigationTotalKm-totalKm)>.01+1e-9)errors.push('Navigation groups and independent component distances differ by over 10 m; inspect the route');
  if(parts.length!==manifest.legs.length)errors.push('Not every declared leg has a valid AMap response');
  const mainLegCount=manifest.legs.filter(x=>x.type==='main').length;
  let mainRouteCoverage=null;
  if(mainLegCount&&mainCoveragePairs.length===mainLegCount){
    mainRouteCoverage=routeCoverage(mainCoveragePairs.map(x=>x.reference),mainCoveragePairs.map(x=>x.actual));
    const c=mainRouteCoverage,largeEnough=c.referenceKm>=5;
    const insufficientCoverage=largeEnough&&(c.referenceCoveredByAmap.within200mPct<70||c.amapCloseToReference.within200mPct<70||c.referenceCoveredByAmap.within500mPct<85||c.amapCloseToReference.within500mPct<85);
    const excessiveContinuousDeviation=largeEnough&&(c.referenceCoveredByAmap.longestBeyond200mKm>2||c.amapCloseToReference.longestBeyond200mKm>2||c.referenceCoveredByAmap.longestBeyond500mKm>1||c.amapCloseToReference.longestBeyond500mKm>1);
    const insufficient=insufficientCoverage||excessiveContinuousDeviation;
    if(insufficient){
      errors.push('Main route overlap is insufficient; add only the minimum route-shaping endpoints needed to prevent large shortcuts');
      warnings.push('Reviewed local reroutes cannot waive poor whole-route GPX coverage');
      if(excessiveContinuousDeviation)warnings.push('A good aggregate percentage cannot hide one long continuous deviation from the fixed route');
    }
  }
  for(let i=0;i<manifest.legs.length-1;i++){
    const groupIndex=groupsAccepted?navSegments.findIndex(x=>x.lastLeg===i+1):i;
    if(groupsAccepted&&groupIndex<0){removalReports.push({boundaryAfterLeg:i+1,internalCompositionBoundary:true,manualSwitchRequired:false});continue;}
    const left=navSegments[groupIndex],right=navSegments[groupIndex+1];
    const boundary=groupsAccepted&&Object.hasOwn(manifest.navigationGroups[groupIndex],'endMandatory')?manifest.navigationGroups[groupIndex]:manifest.legs[i];
    if(boundary.endMandatory===true){
      const leg=boundary,kind=leg.mandatoryKind;
      const kinds=['planned_stop','route_join','route_leave','overnight','option_boundary','access_boundary','fidelity_anchor'];
      if(!kinds.includes(kind)||typeof leg.mandatoryEvidence!=='string'||leg.mandatoryEvidence.trim().length<20)
        errors.push('Mandatory endpoint after leg '+(i+1)+' lacks category and concrete evidence');
      removalReports.push({boundaryAfterLeg:i+1,requiredByPlan:true,kind,evidence:leg.mandatoryEvidence||''});
      continue;
    }
    const test=manifest.removalTests?.find(t=>t.boundaryAfterLeg===i+1);
    const payload=test&&removalResponses[manifest.removalTests.indexOf(test)];
    if(!payload){errors.push('Missing AMap deletion test after leg '+(i+1));continue}
    try{
      const merged=parseEvidence(payload,{...test,start:left.start,end:right.end});
      const date=merged.distanceEvidence?.queriedAt??queryDate(test,manifest,errors,'Deletion test after leg '+(i+1));
      if(merged.issues?.length)throw Error('Deletion test lacks independent corridor review');
      if(metres(merged.points[0],left.start)>120||metres(merged.points.at(-1),right.end)>120)
        throw Error('merged route geometry endpoints differ from tested span by over 120 m');
      const original=[...left.points,...right.points.slice(1)];
      const f=fidelity(original,merged.points);
      const first=groupsAccepted?left.firstLeg:i+1,last=groupsAccepted?right.lastLeg:i+2;
      const waypointIssues=essentialIssues(merged.points,spanEssentials(manifest,first,last),'Deletion test after leg '+(i+1));
      if(groupsAccepted){const extra=manifest.navigationGroups.slice(groupIndex,groupIndex+2).flatMap(x=>x.essentialWaypoints??[]);waypointIssues.push(...essentialIssues(merged.points,extra,'Deletion group span after leg '+(i+1)));}
      const removable=f.orderCompatible&&f.p95Metres<=150&&f.maxMetres<=500&&f.ratio>=.67&&f.ratio<=1.5&&!waypointIssues.length;
      removalReports.push({boundaryAfterLeg:i+1,removable,essentialWaypointsPreserved:waypointIssues.length===0,essentialWaypointIssues:waypointIssues,queriedAt:date,geometrySource:merged.geometrySource||'amap-api-v5-polyline',referenceGeometrySources:[left.geometrySource||'amap-api-v5-polyline',right.geometrySource||'amap-api-v5-polyline'],...f});
      if(removable)errors.push('Navigation endpoint after leg '+(i+1)+' is removable; merge the legs');
    }catch(e){errors.push('Deletion test after leg '+(i+1)+': '+e.message)}
  }
  if((manifest.days||1)===1&&navSegments.length>9)warnings.push('One-day route has many manual navigation switches; review deletion tests');
  const review=manifest.review||{};
  const readiness=reviewStatus(review);
  if(!readiness.complete)errors.push('Human road/access/navigation review with concrete evidence missing: '+readiness.pendingChecks.map(x=>x.code).join(', '));
  if(manifest.queriedAt!==undefined&&!isEvidenceDate(manifest.queriedAt))errors.push('AMap query date missing or invalid');
  const cleanList=(items,label,valid)=>{
    if(items==null)return [];
    if(!Array.isArray(items)){warnings.push(label+' must be an array; omitted');return []}
    return items.filter((item,i)=>{
      if(valid(item))return true;
      warnings.push(label+' item '+(i+1)+' has invalid point or metadata; omitted');
      return false;
    });
  };
  const named=x=>x&&typeof x.name==='string'&&x.name.trim();
  const declaredCues=cleanList(manifest.cues,'cues',x=>named(x)&&(x.kind==='key'?validPoint(x.point):!x.point||validPoint(x.point)));
  const unverifiedKeys=declaredCues.filter(x=>x.kind==='key'&&x.verified===false);
  const cues=declaredCues.filter(x=>!unverifiedKeys.includes(x));
  const supplies=cleanList(manifest.supplies,'supplies',x=>named(x)&&(!x.point||validPoint(x.point)));
  const optionalRoutes=cleanList(manifest.optionalRoutes,'optionalRoutes',x=>named(x)&&Array.isArray(x.points)&&x.points.length>=2&&x.points.every(validPoint)&&(x.distanceKm==null||Number.isFinite(x.distanceKm)&&x.distanceKm>0));
  const turnCandidates=cleanList(manifest.turnCandidates,'turnCandidates',x=>named(x)&&validPoint(x.point));
  const routeEngineGaps=cleanList(manifest.routeEngineGaps,'routeEngineGaps',x=>named(x)&&validPoint(x.start)&&validPoint(x.end)&&Array.isArray(x.points)&&x.points.length>=2&&x.points.every(validPoint)&&Number.isFinite(x.referenceKm)&&x.referenceKm>0&&Number.isFinite(x.amapDistanceKm)&&x.amapDistanceKm>0&&x.amapDistanceKm/x.referenceKm>=5&&isEvidenceDate(x.checkedAt)&&typeof x.evidence==='string'&&x.evidence.trim().length>=20);
  if(manifest.routeEngineGaps!=null&&routeEngineGaps.length!==(Array.isArray(manifest.routeEngineGaps)?manifest.routeEngineGaps.length:0))errors.push('Invalid AMap routing graph gap evidence');
  for(const gap of routeEngineGaps)errors.push('AMap routing graph gap prevents continuous cycling navigation: '+gap.name);
  for(const x of unverifiedKeys){
    warnings.push('Unverified key cue downgraded to turn candidate: '+x.name);
    if(!turnCandidates.some(c=>c.name===x.name&&JSON.stringify(c.point)===JSON.stringify(x.point)))turnCandidates.push({...x,kind:'candidate',note:'未核实关键点候选；'+(x.note||'仅供人工对照，不作正式关键点指引')});
  }
  const queryDates=queryDays(groupsAccepted?navSegments:parts),compositionQueryDates=queryDays(parts);
  const dateSummary=queryDates.length===1?'查询于 '+queryDates[0]:'分段查询日期（上海时区）：'+queryDates.join('、');
  const status=errors.length?'draft':'complete';
  const webParts=(groupsAccepted?navSegments:parts).filter(p=>p.distanceEvidence?.type==='amap-mobile-web');
  const totalDecimals=webParts.length?Math.max(...webParts.map(p=>p.distanceEvidence.displayedDecimals)):3;
  if(webParts.length)warnings.push('Web distances preserve displayed precision; total is approximate and rounding uncertainty is unknown');
  const explanations=[],known=new Set();
  const explain=(pattern,message)=>{const matching=errors.filter(e=>pattern.test(e));if(matching.length){explanations.push(message(matching.length));matching.forEach(e=>known.add(e))}};
  explain(/Web distance and separate geometry/,n=>n+'段网页路线尚未完成与显示折线的同道路走廊核对');
  explain(/Local road candidate/,n=>n+'段仍使用未核实的本地道路候选');
  explain(/Deletion test|Missing AMap deletion test|removable; merge/,n=>n+'处分段边界的删除与合并尚未通过验收');
  explain(/Human road\/access\/navigation review/,()=> '全线道路通行与导航分段复核未完成');
  explain(/deviates from fixed reference/,n=>n+'段高德算路偏离固定参考线');
  explain(/incompatible route order or direction/,n=>n+'段未通过固定参考线的顺序对齐筛查，需核对局部偏离或折返');
  explain(/concrete local alignment review/,n=>n+'段高德与GPX的局部差异尚需核对，不要求逐点重合');
  explain(/essential waypoint/,n=>n+'项必经入口或顺序尚未通过核对');
  explain(/Composition leg/,n=>n+'段可能混合主线尾段与返程，需独立计量组成部分并用导航组保持低切换');
  explain(/Navigation groups:/,()=> '组合导航未通过；当前只展示原始组成候选及其来源，不将失败组合当作已通过路线');
  explain(/route order or direction\/backtracking anomaly/,n=>n+'段方向、环线顺序或折返筛查异常，不能用局部绕行审核豁免');
  explain(/AMap routing graph gap/,n=>n+'处GPX短连接无法由高德骑行路网连续算路，已停止继续堆叠导航端点');
  explain(/Main route overlap is insufficient/,()=> '高德主线与原GPX的全程重叠不足，需增加最少的防抄近约束点后重算');
  if(errors.length>known.size)explanations.push('另有'+(errors.length-known.size)+'项端点、路线几何或证据异常，详见验收报告');
  for(const part of parts)part.verified=status==='complete';
  let referenceRoutes=manifest.legs.filter(x=>x.type==='main'&&Array.isArray(x.referencePoints)&&x.referencePoints.length>=2&&x.referencePoints.every(validPoint))
    .map(x=>({name:x.name+' · 参考线',points:x.referencePoints,source:x.referenceSource||x.geometryEvidence?.source||'provided-reference',basis:'独立提供的对照折线，不代表高德算路或路权已经核实'}));
  if(manifest.originalGpx){
    const original=manifest.originalGpx;
    if(!Array.isArray(original.points)||original.points.length<2||!original.points.every(validPoint))throw Error('Original GPX needs valid WGS-84 points');
    referenceRoutes=[{name:original.name||'原始GPX',points:original.points,source:'original-gpx',basis:'原始GPX折线，仅作路书对照；不代表高德骑行距离或现场通行已核实'}];
  }
  const gapSummary=routeEngineGaps.length?`高德路网与GPX不一致：${routeEngineGaps.slice(0,2).map(x=>x.name).join('、')}${routeEngineGaps.length>2?`等${routeEngineGaps.length}处`:''}无法连续算路，需停车核对`:null;
  const data={
    status,alignmentMode,topology:manifest.topology??null,direction:manifest.direction??null,originalGpx:manifest.originalGpx||null,title:manifest.title||'骑行交互地图',subtitle:manifest.subtitle||'原GPX与高德方案对照',
    draftSummary:status==='complete'?null:gapSummary??(errors.some(e=>/concrete local alignment review/.test(e))?'GPX与高德的局部差异待核对':errors.some(e=>/deviates from fixed reference/.test(e))?'高德方案与固定参考线不一致':errors.some(e=>/Web distance and separate geometry/.test(e))?'网页路线与道路折线尚未核对':errors.some(e=>/order or direction/.test(e))?'固定参考线的顺序对齐待核实':'接驳、道路或距离证据待核实'),
    routeParts:parts,referenceRoutes,navSegments,cues,supplies,optionalRoutes,turnCandidates,routeEngineGaps,reviewStatus:readiness,queryDates,compositionQueryDates,navigationTotalKm:Number(navigationTotalKm.toFixed(3)),compositionDifferenceKm,compositionTotalKm:Number(totalKm.toFixed(3)),mainRouteCoverage,
    ...(groupsAccepted?{navigationRouteParts:navSegments.map(x=>({...x,verified:status==='complete'}))}:{}),
    ...(manifest.tileUrl?{tileUrl:manifest.tileUrl,tileAttribution:manifest.tileAttribution||''}:{}),
    totalKm:status==='complete'?Number(navigationTotalKm.toFixed(Math.min(totalDecimals,3))):null,
    totalApproximate:webParts.length>0,
    distanceBasis:status==='complete'?(webParts.length?'高德骑行结果含网页显示值；总和为近似值，舍入规则未确认；详见各段出处':'高德 Web Service v5 骑行结果，'+dateSummary):'部分高德骑行证据；完整路线未通过验收',
    note:(compositionDifferenceKm?'导航段与独立组成部分的高德查询总和相差'+Math.round(compositionDifferenceKm*1000)+'米；分别保留来源，不按几何比例虚分里程。':'')+(alignmentMode==='gpx-guided'?'GPX作原路书对照，高德尽量贴近，不要求逐点重合；重点核对易错入口与明显偏离。':'严格保持指定固定路线。')+(status==='complete'?'高德手机导航仍可能重新算路；实际道路以现场标志为准。':'未完成：'+explanations.join('；')+'。候选分段不是已确认导航，切换次数尚未确定。')
  };
  if(manifest.legs.some(x=>x.referenceSpans?.length>1))data.note+=' 原GPX缺口两侧参考分开保存；部分范围比较不代表缺口道路已经审核。';
  if(manifest.note!=null){
    if(typeof manifest.note!=='string')throw Error('Planning note must be text');
    if(manifest.note.trim())data.note+=' 规划说明：'+manifest.note.trim();
  }
  return {data,report:{status,alignmentMode,navigationGroupsAccepted:groupsAccepted,queryDates,compositionQueryDates,reviewStatus:readiness,navigationTotalKm:Number(navigationTotalKm.toFixed(3)),compositionDifferenceKm,navigationSegmentCount:navSegments.length,totalCandidateKm:Number(totalKm.toFixed(3)),usableTotalKm:data.totalKm,legCount:manifest.legs.length,validLegCount:parts.length,routeEngineGaps,errors,warnings,fidelityReports,mainRouteCoverage,removalReports}};
}

export async function renderMap(template,data){
  if(!template.includes('__ROUTE_DATA_JSON__'))throw Error('Map template data slot missing');
  let html=template.replace('__ROUTE_DATA_JSON__',()=>JSON.stringify(data).replace(/</g,'\\u003c'));
  const cssTag='<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">';
  const jsTag='<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>';
  if(html.includes(cssTag)||html.includes(jsTag)){
    if(!html.includes(cssTag)||!html.includes(jsTag))throw Error('Both pinned Leaflet tags are required for inlining');
    const vendor=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../assets/vendor/leaflet');
    let [css,js,license]=await Promise.all(['leaflet.css','leaflet.js','LICENSE'].map(x=>fs.readFile(path.join(vendor,x),'utf8')));
    if(/<\/script/i.test(js)||/<\/style/i.test(css))throw Error('Vendor asset contains an HTML closing tag');
    for(const name of ['layers.png','layers-2x.png','marker-icon.png']){
      const png=await fs.readFile(path.join(vendor,'images',name));
      css=css.replaceAll('url(images/'+name+')','url(data:image/png;base64,'+png.toString('base64')+')');
    }
    html=html.replace(cssTag,()=>'<style>'+css+'</style>');
    html=html.replace(jsTag,()=>'<script>/*\n'+license.replace(/\*\//g,'* /')+'\n*/\n'+js+'</script>');
  }
  return html;
}

async function main(args){
  const values={};
  for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith('--')||args[i+1]===undefined)throw Error('Use --manifest FILE --template FILE --out-html FILE --out-report FILE');values[args[i].slice(2)]=args[i+1]}
  for(const k of ['manifest','template','out-html','out-report'])if(!values[k])throw Error('Missing --'+k);
  const manifestPath=path.resolve(values.manifest),base=path.dirname(manifestPath);
  const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
  const responses=await Promise.all(manifest.legs.map(async leg=>{
    if(!leg.responseFile)throw Error('Each leg must specify responseFile');
    const record=JSON.parse(await fs.readFile(path.resolve(base,leg.responseFile),'utf8'));
    if(leg.evidenceType==='amap-mobile-web')for(const key of ['mapScreenshot','detailsScreenshot']){
      if(!record[key])throw Error('Web screenshot missing');
      await fs.access(path.resolve(path.dirname(path.resolve(base,leg.responseFile)),record[key]));
    }
    return record;
  }));
  const removalResponses=await Promise.all((manifest.removalTests||[]).map(async test=>{
    if(!test.responseFile)throw Error('Deletion test needs responseFile');
    const record=JSON.parse(await fs.readFile(path.resolve(base,test.responseFile),'utf8'));
    if(test.evidenceType==='amap-mobile-web')for(const key of ['mapScreenshot','detailsScreenshot']){
      if(!record[key])throw Error('Web deletion screenshot missing');
      await fs.access(path.resolve(path.dirname(path.resolve(base,test.responseFile)),record[key]));
    }
    return record;
  }));
  const groupResponses=await Promise.all((manifest.navigationGroups||[]).map(async g=>{
    if(!g.responseFile)throw Error('Each navigation group needs its original responseFile');
    const file=path.resolve(base,g.responseFile),record=JSON.parse(await fs.readFile(file,'utf8'));
    if(g.evidenceType==='amap-mobile-web')for(const key of ['mapScreenshot','detailsScreenshot']){if(!record[key])throw Error('Group web screenshot missing');await fs.access(path.resolve(path.dirname(file),record[key]));}
    return record;
  }));
  const {data,report}=assemble(manifest,responses,removalResponses,groupResponses);
  const template=await fs.readFile(values.template,'utf8');
  const html=await renderMap(template,data);
  report.mapSha256=createHash('sha256').update(html).digest('hex');
  await fs.mkdir(path.dirname(path.resolve(values['out-html'])),{recursive:true});
  await fs.mkdir(path.dirname(path.resolve(values['out-report'])),{recursive:true});
  await fs.writeFile(values['out-html'],html);
  await fs.writeFile(values['out-report'],JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,errors:report.errors.length,usableTotalKm:report.usableTotalKm}));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1});
}
