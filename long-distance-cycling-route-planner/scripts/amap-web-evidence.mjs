import {gcjToWgs,metres} from './diagnose-osm-route.mjs';
import {isEvidenceDate} from './evidence-dates.mjs';

export function parseVisibleMobileRide(evidence){
  const map=new URL(evidence.mapUrl),detail=new URL(evidence.detailUrl);
  if(map.protocol!=='https:'||detail.protocol!=='https:'||map.hostname!=='m.amap.com'||!map.pathname.startsWith('/navigation/ridemap/')||
    detail.hostname!=='m.amap.com'||!detail.pathname.startsWith('/navigation/ridedetail/')||
    !evidence.title?.startsWith('骑车'))throw Error('Not a confirmed official mobile cycling result');
  const m=evidence.summaryLabel?.match(/^(?:(\d+)小时)?(?:(\d+)分钟)?([0-9]+(?:\.[0-9]+)?)(公里|米)$/);
  if(!m||(!m[1]&&!m[2])||Number(m[3])<=0)throw Error('Visible route summary missing or invalid; map scale is not distance');
  if(!Array.isArray(evidence.steps)||!evidence.steps.length)throw Error('Visible cycling steps missing');
  const lengths=evidence.steps.map(s=>s.match(/骑行([0-9.]+)(米|公里)/)).filter(Boolean)
    .map(x=>Number(x[1])*(x[2]==='公里'?1000:1));
  if(!lengths.length)throw Error('Visible cycling distances missing from steps');
  return {
    status:'captured-not-accepted',summaryLabel:evidence.summaryLabel,
    displayedDistanceKm:m[4]==='米'?Number(m[3])/1000:Number(m[3]),
    displayedDecimals:(m[3].split('.')[1]||'').length+(m[4]==='米'?3:0),roundingRuleKnown:false,
    displayedMinutes:Number(m[1]||0)*60+Number(m[2]||0),
    visibleStepSumMetres:lengths.reduce((s,d)=>s+d,0),
    stepSumBasis:'Sum of displayed step lengths; derived and potentially rounded, not official API total',
    geometryExported:false,fixedCorridorVerified:false,usableTotalKm:null
  };
}

function point(value){
  const [lon,lat]=String(value||'').split(',').slice(0,2).map(Number);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw Error('Web query endpoints missing');
  return gcjToWgs([lat,lon]);
}
function sameEndpoints(url,prefix,leg){
  const params=new URLSearchParams(url.pathname.slice(prefix.length));
  if(metres(point(params.get('saddr')),leg.start)>3||metres(point(params.get('daddr')),leg.end)>3)throw Error('Web result endpoints differ from declared leg');
}

export function parseWebRouteRecord(record,leg){
  if(record.status!=='captured-not-accepted'||!isEvidenceDate(record.queriedAt))throw Error('Successful dated mobile web capture required');
  const uri=new URL(record.requestedUri);
  if(uri.protocol!=='https:'||uri.hostname!=='uri.amap.com'||uri.pathname!=='/navigation'||uri.searchParams.get('mode')!=='ride'||uri.searchParams.get('callnative')!=='0')throw Error('Official browser cycling URI required');
  if(metres(point(uri.searchParams.get('from')),leg.start)>3||metres(point(uri.searchParams.get('to')),leg.end)>3)throw Error('Requested web endpoints differ from declared leg');
  const summary=record.details?.text?.split('\n').map(s=>s.trim()).find(s=>/^(?:(\d+)小时)?(?:(\d+)分钟)?([0-9]+(?:\.[0-9]+)?)(公里|米)$/.test(s));
  const parsed=parseVisibleMobileRide({mapUrl:record.map?.url,detailUrl:record.details?.url,title:record.details?.title,summaryLabel:summary,steps:record.details?.steps});
  sameEndpoints(new URL(record.map.url),'/navigation/ridemap/',leg);
  sameEndpoints(new URL(record.details.url),'/navigation/ridedetail/',leg);
  if(!record.mapScreenshot||!record.detailsScreenshot)throw Error('Web result screenshots required');
  const g=leg.geometryEvidence;
  if(!g||g.coordinateSystem!=='WGS-84'||!['original-gpx','reviewed-road-geometry','local-road-candidate'].includes(g.source)||typeof g.sourceEvidence!=='string'||g.sourceEvidence.trim().length<20||
    !Array.isArray(g.points)||g.points.length<2||!g.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180))throw Error('Web distance needs separate explicitly sourced road geometry');
  const review=g.corridorReview;
  const checked=review?.checked===true&&typeof review.evidence==='string'&&review.evidence.trim().length>=20&&isEvidenceDate(review.checkedAt);
  return {distanceKm:parsed.displayedDistanceKm,points:g.points,stepCount:record.details.steps.length,
    sourceType:'amap-mobile-web',displayedDecimals:parsed.displayedDecimals,approximate:true,
    basis:'高德手机网页骑行显示值：'+parsed.summaryLabel+'；查询于 '+record.queriedAt+'；几何出处：'+g.source+'；舍入规则未确认',
    distanceEvidence:{type:'amap-mobile-web',queriedAt:record.queriedAt,label:parsed.summaryLabel,uri:record.requestedUri,displayedDecimals:parsed.displayedDecimals,roundingRuleKnown:false},
    geometrySource:g.source,issues:[...(checked?[]:['Web distance and separate geometry lack independently documented corridor review']),
      ...(g.source==='local-road-candidate'?['Local road candidate is not certified road geometry']:[])]};
}
