import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {parseGpxGeometry} from './diagnose-osm-route.mjs';
import {renderMap} from './assemble-amap-map.mjs';

const validPoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180;

// This mode preserves source geometry only. It deliberately makes no route,
// direction, topology, road-access, navigation, or distance decision.
export function prepareGpxPreview(parsed,options={}){
  if(!parsed||!['track','route'].includes(parsed.sourceKind)||!Array.isArray(parsed.segments)||!parsed.segments.length)throw Error('Parsed GPX segments required');
  if(parsed.segments.some(segment=>!Array.isArray(segment)||segment.length<2||!segment.every(validPoint)))throw Error('Each GPX source segment needs at least two valid points');
  for(const key of ['startName','title'])if(options[key]!==undefined&&typeof options[key]!=='string')throw Error(key+' must be text');
  const segments=parsed.segments.map(segment=>segment.map(point=>[...point]));
  const pointCount=segments.reduce((sum,segment)=>sum+segment.length,0);
  const segmentGapCount=Math.max(0,segments.length-1);
  const startText=options.startName?.trim();
  const blockers=[
    '只有原始 GPX 几何参考，未选择拓扑和方向',
    startText?'起点“'+startText+'”仅为未定位名称，未猜测坐标':'未提供或定位实际起点',
    '未生成实际起终点接驳、道路路线或闭环',
    '没有道路服务、道路通行与当前开放证据',
    '没有导航分段、下一点指引或道路骑行总里程',
    '不含详细底图和道路服务；后续需在获准条件下补做地点定位、道路算路和完整地图验收',
    ...(segmentGapCount?['原 GPX 含 '+segments.length+' 个独立段；保留 '+segmentGapCount+' 处段间空白，不按文件顺序连线']:[])
  ];
  const referenceRoutes=segments.map((points,index)=>({
    name:'原始 GPX '+(parsed.sourceKind==='track'?'轨迹':'路线')+'段 '+(index+1),
    points,
    source:'original-gpx',
    basis:'原始 GPX 独立段；段间不连线；仅作几何参考，不是导航距离、道路许可或方向证据'
  }));
  const pendingChecks=[
    {code:'START_LOCATION',name:'实际起点尚未定位',owner:'user-choice',action:'确认大致起点后使用获准的地点检索取得坐标，不从名称猜测'},
    {code:'ROUTE_INTENT',name:'拓扑和方向尚未选择',owner:'user-choice',action:'明确 open/loop 与 forward/reverse 后再组装道路路线'},
    {code:'ROAD_NAVIGATION',name:'道路接驳、通行与导航距离尚无证据',owner:'agent',action:'在获准条件下使用 OSM 研究或高德完整流程，并执行道路、距离与设备验收'},
    {code:'DETAILED_MAP',name:'当前预览没有详细底图',owner:'agent',action:'后续按地图契约生成并检查获准的详细底图；当前文件只显示 GPX 参考线'}
  ];
  const data={
    mode:'gpx-only-reference',status:'draft',topology:null,direction:null,
    title:options.title?.trim()||'GPX-only 未完成参考预览',
    subtitle:'仅显示原始 GPX；缺少详细底图、道路路线与导航服务',
    draftSummary:'仅有 GPX 参考线；起点、拓扑、方向和道路证据待核实',
    startName:startText||null,
    routeParts:[],navSegments:[],cues:[],supplies:[],optionalRoutes:[],turnCandidates:[],
    originalGpx:{name:'完整原始GPX（按段保留）',sourceKind:parsed.sourceKind,namespace:parsed.namespace,version:parsed.version,segments,segmentCount:segments.length,pointCount,coordinateSystem:'WGS-84（GPX标准坐标）'},
    referenceRoutes,totalKm:null,distanceBasis:'未生成道路或导航距离；GPX 几何不作为完整骑行总里程',
    tileUrl:null,localRoads:[],researchMarkers:[],
    reviewStatus:{pendingChecks,deviceAcceptance:{status:'not-tested',owner:'device',action:'道路与导航方案完成后再做真实手机 App 和 GPS 验收'}},
    note:'GPX-only 未完成参考预览：'+blockers.join('；')+'。'
  };
  const report={
    reportKind:'gpx-only-reference',mode:data.mode,status:'draft',usableTotalKm:null,
    rawPointCount:pointCount,originalReferencePointCount:pointCount,segmentCount:segments.length,segmentGapCount,
    partCount:0,navigationSegments:0,verifiedKeyPoints:0,topology:null,direction:null,startName:startText||null,
    blockers,reviewStatus:data.reviewStatus,
    acceptance:{
      skillGeneration:{status:'produced-gpx-only-draft',scope:'GPX parsing, segment preservation and bundled-template rendering only'},
      routeRideability:{status:'not-accepted',blockers:[...blockers],deviceAcceptance:'not-tested'}
    }
  };
  return {data,report};
}

async function main(args){
  const values={},allowed=new Set(['gpx','out-dir','start-name','title']);
  for(let i=0;i<args.length;i+=2){
    const key=args[i]?.slice(2);
    if(!args[i]?.startsWith('--')||args[i+1]===undefined||!allowed.has(key)||Object.hasOwn(values,key))throw Error('Unknown, duplicate or missing CLI option');
    values[key]=args[i+1];
  }
  for(const key of ['gpx','out-dir'])if(!values[key])throw Error('Missing --'+key);
  const xml=await fs.readFile(values.gpx,'utf8');
  const {data,report}=prepareGpxPreview(parseGpxGeometry(xml),{startName:values['start-name'],title:values.title});
  const template=await fs.readFile(new URL('../assets/map-shell.html',import.meta.url),'utf8');
  const html=await renderMap(template,data);
  report.mapSha256=createHash('sha256').update(html).digest('hex');
  await fs.mkdir(values['out-dir'],{recursive:true});
  await Promise.all([
    fs.writeFile(path.join(values['out-dir'],'gpx-preview.html'),html),
    fs.writeFile(path.join(values['out-dir'],'gpx-preview-data.json'),JSON.stringify(data,null,2)),
    fs.writeFile(path.join(values['out-dir'],'gpx-preview-report.json'),JSON.stringify(report,null,2))
  ]);
  console.log(JSON.stringify({status:report.status,mode:report.mode,segmentCount:report.segmentCount,
    segmentGapCount:report.segmentGapCount,rawPointCount:report.rawPointCount,usableTotalKm:null,outDir:values['out-dir']}));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  main(process.argv.slice(2)).catch(error=>{console.error(error.message);process.exitCode=1});
}
