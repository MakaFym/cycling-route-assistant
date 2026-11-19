import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseGpx,diagnose,buildRoadNetwork,shortest,metres,gcjToWgs} from './diagnose-osm-route.mjs';
import {renderMap} from './assemble-amap-map.mjs';
import {createHash} from 'node:crypto';

const USAGE=`Usage:
  node scripts/prepare-research-map.mjs --gpx INPUT.gpx --osm ROADS.json --start LAT,LON --start-crs wgs84|gcj02 --topology loop|open --direction forward|reverse --out-dir PRIVATE_DIR [options]

Required options:
  --gpx FILE             source GPX
  --osm FILE             previously obtained local OSM JSON
  --start LAT,LON        actual start coordinates
  --start-crs CRS        wgs84 or gcj02
  --topology VALUE       loop or open
  --direction VALUE      forward or reverse
  --out-dir DIR          new private output location

Optional options:
  --end LAT,LON --end-crs CRS --gpx-crs auto|wgs84|gcj02
  --title TEXT --days INTEGER --start-name TEXT --end-name TEXT

This command creates a local research draft only. It does not use a browser or network,
and its candidate geometry is not navigation mileage or an accepted rideable route.`;

// This produces a LOCAL research preview, never official navigation mileage.
export function prepareResearch(points,osm,start,options={}){
  if(!['wgs84','gcj02'].includes(options.startCrs))throw Error('Explicit startCrs required');
  if(!['loop','open'].includes(options.topology)||!['forward','reverse'].includes(options.direction))throw Error('Explicit topology and direction required');
  const valid=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180;
  if(!valid(start)||points.length<2||!points.every(valid))throw Error('Invalid route coordinates');
  const days=options.days??1;
  if(!Number.isInteger(days)||days<1)throw Error('days must be a positive integer');
  if(options.end!==undefined&&(!valid(options.end)||!['wgs84','gcj02'].includes(options.endCrs)))throw Error('Explicit valid end and endCrs required');
  const sourceDiagnostics=diagnose(points,osm,start,options);
  const origin=options.startCrs==='gcj02'?gcjToWgs(start):start;
  const fixed=sourceDiagnostics.coordinates.selectedHypothesis==='GCJ02'?points.map(gcjToWgs):points;
  const ordered=options.direction==='reverse'?[...fixed].reverse():fixed;
  const destination=options.end===undefined?(options.topology==='loop'?origin:ordered.at(-1)):
    options.endCrs==='gcj02'?gcjToWgs(options.end):options.end;
  const diagnostics=diagnose(ordered,osm,origin,{...options,startCrs:'wgs84',gpxCrs:'wgs84'});
  diagnostics.coordinates=sourceDiagnostics.coordinates;
  diagnostics.scope='local-road-probe; not requested-route mileage';
  diagnostics.distance.rawGraphSumKm=null;
  const roads=buildRoadNetwork(osm),startSnap=roads.snap(origin,true);
  const endSnap=roads.snap(destination,true),head=roads.snap(ordered[0],true),tail=roads.snap(ordered.at(-1),true);
  const candidateIndices=new Set([0,ordered.length-1]);
  for(let i=0;i<ordered.length;i+=Math.max(1,Math.floor(ordered.length/25)))candidateIndices.add(i);
  for(const p of [origin,destination]){
    let closest=0;for(let i=1;i<ordered.length;i++)if(metres(p,ordered[i])<metres(p,ordered[closest]))closest=i;
    candidateIndices.add(closest);
  }
  const choices=options.topology==='loop'?[...candidateIndices].map(gpxIndex=>({gpxIndex,snap:roads.snap(ordered[gpxIndex],true)})):[];
  const adj=roads.graph(),roadPath=(a,b)=>shortest(adj,roads.vertices,a.id,b.id,true);
  const ranked=choices.map(c=>({...c,outbound:roadPath(startSnap,c.snap),inbound:roadPath(c.snap,endSnap)}))
    .filter(c=>c.outbound&&c.inbound).sort((a,b)=>(a.outbound.distance+a.inbound.distance)-(b.outbound.distance+b.inbound.distance));
  const selected=ranked[0];
  const outbound=options.topology==='loop'?selected?.outbound:roadPath(startSnap,head);
  const inbound=options.topology==='loop'?selected?.inbound:roadPath(tail,endSnap);
  const closure=options.topology==='loop'?roadPath(tail,head):null;
  const routeParts=[],add=(type,name,geometry,basis)=>{
    if(geometry?.length>1)routeParts.push({type,name,points:geometry,distanceKm:null,basis,verified:false});
  };
  const joinIndex=selected?.gpxIndex??0;
  add('outbound','去程道路候选（未核实）',outbound?.points,'本地 OSM 道路候选；不是高德骑行结果');
  if(options.topology==='loop'){
    add('main','路书后半段（从候选接入点开始）',ordered.slice(joinIndex),'原始 GPX；不是导航生成里程');
    add('main','首尾闭环道路候选（未核实）',closure?.points,'本地 OSM 闭环候选；需核对道路与通行');
    add('main','路书前半段（回到候选接入点）',ordered.slice(0,joinIndex+1),'原始 GPX；不是导航生成里程');
  }else add('main','非闭环路书（按指定方向完整保留）',ordered,'原始 GPX；不是导航生成里程');
  add('return',options.topology==='loop'?'返程道路候选（未核实）':'终点接驳候选（未核实）',inbound?.points,'本地 OSM 道路候选；不是高德骑行结果');
  const gapMetres=metres(fixed[0],fixed.at(-1));
  const blockers=[
    '实际起终点坐标、道路侧别及合法接入未核实',
    options.topology==='loop'?'接入点仅按实际起终点的本地道路代价提出，尚未核对道路入口与方向':'非闭环接驳只接到指定方向的路书首尾；道路入口与通行尚未核实',
    '高德全线骑行距离、路线贴合及终点删除测试尚未完成',
    '道路通行与现状未核实',
    ...(diagnostics.gaps.length?['本地道路图存在 '+diagnostics.gaps.length+' 处断点']:[]),
    ...(diagnostics.detourCount?['本地道路图存在 '+diagnostics.detourCount+' 处绕行或投影异常']:[])
  ];
  if(!outbound||!inbound)blockers.push('去程或返程道路候选缺失');
  if(options.topology==='loop'&&!closure)blockers.push('路书首尾闭环道路候选缺失；不得直线闭合');
  if(diagnostics.coordinates.selectedHypothesis==='ambiguous')blockers.push('GPX坐标系假设有歧义；需来源证据');
  const boundaries=routeParts.slice(1).map((p,i)=>({fromPart:i+1,toPart:i+2,metres:metres(routeParts[i].points.at(-1),p.points[0])}));
  const gaps=boundaries.filter(x=>x.metres>1);
  if(gaps.length)blockers.push('候选组成存在 '+gaps.length+' 处接缝缺口；不添加跨段直线');
  if(startSnap.distance>1||endSnap.distance>1)blockers.push('实际起终点与道路投影之间有偏移；未画直线代替道路接驳');
  const localRoads=osm.elements.filter(w=>w.type==='way'&&w.tags?.highway&&w.geometry?.length>1)
    .map(w=>({name:w.tags.name||'',highway:w.tags.highway,points:w.geometry.map(p=>[p.lat,p.lon])}));
  const data={
    status:'draft',topology:options.topology,direction:options.direction,title:options.title||'真实路书研究预览',
    draftSummary:'接驳路权、'+(options.topology==='loop'?'闭环、':'')+'全线距离待核实',
    subtitle:'仅本地道路与路书核对；不是已验收导航地图',
    routeParts,navSegments:[],cues:[],supplies:[],optionalRoutes:[],turnCandidates:[],
    originalGpx:{name:'完整原始GPX',points:fixed,inputCoordinateSystem:diagnostics.coordinates.selectedHypothesis,coordinateSystem:'WGS-84'},
    referenceRoutes:[{name:'完整原始GPX',points:fixed,source:'original-gpx',basis:'原始GPX按输入顺序独立保留；仅几何参考，不是导航里程'}],
    totalKm:null,distanceBasis:'没有已核实的高德骑行总里程',
    // No tile requests: this preview must not silently disclose private route extent.
    tileUrl:null,localRoads,
    researchMarkers:[
      {name:options.startName||'实际起点候选（入口待核对）',point:origin},
      {name:options.endName||'实际终点候选（入口待核对）',point:destination},
      ...(selected?[{name:'实际起终点道路代价较低的接入候选（非最终方案）',point:ordered[joinIndex]}]:[]),
      {name:'原 GPX 起点（独立参考）',point:fixed[0]},
      {name:'原 GPX 终点（独立参考）',point:fixed.at(-1)}
    ],
    note:'研究草稿：'+blockers.join('；')+'。原路书首尾相距约 '+Math.round(gapMetres)+' m。'
  };
  const report={
    status:'draft',usableTotalKm:null,rawPointCount:points.length,days,
    topology:options.topology,direction:options.direction,actualStart:origin,actualEnd:destination,
    startCoordinateVerified:false,selectedJoinIndex:selected?(options.direction==='reverse'?fixed.length-1-joinIndex:joinIndex):null,
    requestedJoinIndex:selected?.gpxIndex??null,startSnapMetres:startSnap.distance,endSnapMetres:endSnap.distance,boundaryGaps:gaps,
    originalEndpointGapMetres:gapMetres,originalReferencePointCount:fixed.length,partCount:routeParts.length,
    outboundCandidatePoints:outbound?.points?.length||0,returnCandidatePoints:inbound?.points?.length||0,
    closureCandidatePoints:closure?.points?.length||0,localRoadCount:localRoads.length,
    navigationSegments:0,verifiedKeyPoints:0,blockers,diagnostics,
    acceptance:{skillGeneration:{status:'produced-research-draft',scope:'Local input adaptation and rendering only; independent package tests required'},
      routeRideability:{status:'not-accepted',blockers:[...blockers],deviceAcceptance:'not-tested'}}
  };
  return {data,report};
}

async function main(args){
  if(args.length===1&&args[0]==='--help'){console.log(USAGE);return}
  const v={};
  const allowed=new Set(['gpx','osm','start','start-crs','end','end-crs','topology','direction','out-dir','title','days','gpx-crs','start-name','end-name']);
  for(let i=0;i<args.length;i+=2){const k=args[i]?.slice(2);if(!args[i]?.startsWith('--')||args[i+1]===undefined||!allowed.has(k)||k in v)throw Error('Unknown, duplicate or missing CLI option');v[k]=args[i+1]}
  for(const k of ['gpx','osm','start','start-crs','topology','direction','out-dir'])if(!v[k])throw Error('Missing --'+k);
  if(v['end-crs']&&!v.end)throw Error('--end-crs requires --end');
  const [xml,raw]=await Promise.all([fs.readFile(v.gpx,'utf8'),fs.readFile(v.osm,'utf8')]);
  const {data,report}=prepareResearch(parseGpx(xml),JSON.parse(raw),v.start.split(',').map(Number),
    {startCrs:v['start-crs'],end:v.end?.split(',').map(Number),endCrs:v['end-crs'],topology:v.topology,direction:v.direction,
      startName:v['start-name'],endName:v['end-name'],title:v.title,days:Number(v.days||1),gpxCrs:v['gpx-crs']||'auto'});
  const template=await fs.readFile(new URL('../assets/map-shell.html',import.meta.url),'utf8');
  const html=await renderMap(template,data);
  report.mapSha256=createHash('sha256').update(html).digest('hex');
  await fs.mkdir(v['out-dir'],{recursive:true});
  await Promise.all([
    fs.writeFile(path.join(v['out-dir'],'research-map.html'),html),
    fs.writeFile(path.join(v['out-dir'],'research-data.json'),JSON.stringify(data)),
    fs.writeFile(path.join(v['out-dir'],'research-report.json'),JSON.stringify(report,null,2))
  ]);
  console.log(JSON.stringify({status:report.status,rawPointCount:report.rawPointCount,selectedJoinIndex:report.selectedJoinIndex,
    partCount:report.partCount,usableTotalKm:null,outDir:v['out-dir']}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1});
}
