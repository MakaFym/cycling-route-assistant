import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const hash=x=>createHash('sha256').update(x).digest('hex');
const md=x=>String(x??'未记录').replace(/([\\`*_\[\]<>|])/g,'\\$1').replace(/\r?\n/g,' ');
const numeric=x=>Number.isFinite(x)?x:null;
const knownArray=x=>Array.isArray(x)?x:null;
const display=x=>x===null||x===undefined?'未记录':typeof x==='number'?String(Number(x.toFixed(3))):md(x);
const distanceEvidence=x=>x?{type:x.type??null,queriedAt:x.queriedAt??null,label:x.label??null,displayedDecimals:numeric(x.displayedDecimals),roundingRuleKnown:typeof x.roundingRuleKnown==='boolean'?x.roundingRuleKnown:null}:null;
const distanceRecord=(p,i)=>({index:i+1,type:p.type??null,name:p.name??null,distanceKm:numeric(p.distanceKm),basis:p.basis??null,evidence:distanceEvidence(p.distanceEvidence)});
function gpsCoverage(x,status){
 const g=x.gpsSegmentSelection;
 if(!g||!Array.isArray(g.cases)||!Array.isArray(g.skipped))return {status:status==='draft'?'not-applicable-draft':'not-tested',testedSamples:null,skippedSamples:null,skipped:[]};
 return {status:g.cases.length?g.skipped.length?'partial':'passed-simulated-samples':'not-tested',testedSamples:g.cases.length,skippedSamples:g.skipped.length,skipped:g.skipped.map(s=>({segment:s.segment??null,reason:s.reason??null}))};
}

export function buildJobReport({mapHtml,acceptance,browserResults,generatedAt=new Date().toISOString()}){
 if(typeof mapHtml!=='string')throw Error('Generated map HTML required');
 const matches=[...mapHtml.matchAll(/^const D=(\{[\s\S]*?\});\s*const \$/gm)];
 if(matches.length!==1)throw Error('Generated map data slot missing or ambiguous');
 const data=JSON.parse(matches[0][1]),mapSha256=hash(mapHtml);
 if(acceptance?.mapSha256!==mapSha256)throw Error('Unbound or stale acceptance evidence: map hash differs; regenerate acceptance');
 if(!['draft','complete'].includes(data.status)||data.status!==acceptance?.status)throw Error('Map and acceptance status differ');
 const gpxOnly=data.mode==='gpx-only-reference';
 const routeParts=knownArray(data.routeParts),navSegments=knownArray(data.navSegments);
 if(!gpxOnly&&(!routeParts||!navSegments))throw Error('Map route arrays missing');
 const safeRouteParts=routeParts??[],safeNavSegments=navSegments??[];
 const originalSegments=knownArray(data.originalGpx?.segments);
 const originalPointCount=knownArray(data.originalGpx?.points)?.length??(originalSegments?originalSegments.reduce((sum,segment)=>sum+(knownArray(segment)?.length??0),0):null);
 const gpxExpectedValues={mode:'gpx-only-reference',status:'draft',topology:null,direction:null,totalKm:null,tileUrl:null};
 const gpxEmptyArrays=['routeParts','navSegments','cues','supplies','optionalRoutes','turnCandidates','localRoads','researchMarkers'];
 const gpxForbiddenFields=['actualStart','actualEnd','navigationRouteParts','tileAttribution'];
 const gpxMissingFields=gpxOnly?[
  ...Object.keys(gpxExpectedValues).filter(key=>!Object.hasOwn(data,key)),
  ...gpxEmptyArrays.filter(key=>!Object.hasOwn(data,key)),
  ...(!Object.hasOwn(data,'referenceRoutes')?['referenceRoutes']:[]),
  ...(!originalSegments?['originalGpx.segments']:[]),
  ...(!Object.hasOwn(acceptance,'reportKind')?['acceptance.reportKind']:[])
 ]:[];
 const gpxViolations=gpxOnly?[
  ...Object.entries(gpxExpectedValues).filter(([key,value])=>Object.hasOwn(data,key)&&data[key]!==value).map(([key])=>key),
  ...gpxEmptyArrays.filter(key=>Object.hasOwn(data,key)&&(!Array.isArray(data[key])||data[key].length!==0)),
  ...(Object.hasOwn(data,'referenceRoutes')&&(!Array.isArray(data.referenceRoutes)||data.referenceRoutes.length===0)?['referenceRoutes']:[]),
  ...(originalSegments&&originalSegments.length===0?['originalGpx.segments']:[]),
  ...gpxForbiddenFields.filter(key=>Object.hasOwn(data,key)),
  ...(Object.hasOwn(acceptance,'reportKind')&&acceptance.reportKind!=='gpx-only-reference'?['acceptance.reportKind']:[])
 ]:[];
 const gpxDataContract={status:!gpxOnly?'not-applicable':gpxViolations.length?'failed':gpxMissingFields.length?'not-tested':'passed',missingFields:gpxMissingFields,violations:gpxViolations};
 if(acceptance.reportKind==='gpx-only-reference'&&!gpxOnly)throw Error('GPX-only acceptance requires GPX-only map mode');
 if(Object.hasOwn(acceptance,'usableTotalKm')&&acceptance.usableTotalKm!==data.totalKm)throw Error('Map and acceptance usable mileage differ');
 if(data.status==='draft'&&data.totalKm!==null)throw Error('Draft cannot contain approved total mileage');
 for(const [a,d] of [['totalCandidateKm','compositionTotalKm'],['navigationTotalKm','navigationTotalKm'],['validLegCount','routeParts'],['navigationSegmentCount','navSegments'],['partCount','routeParts'],['originalReferencePointCount','originalGpx']]){
  if(!Object.hasOwn(acceptance,a))continue;
  const actual=d==='routeParts'?safeRouteParts.length:d==='navSegments'?safeNavSegments.length:d==='originalGpx'?originalPointCount:data[d];
  if(actual!==undefined&&acceptance[a]!==actual)throw Error('Map and acceptance source field differ: '+a);
 }
 if(data.queryDates&&JSON.stringify(data.queryDates)!==JSON.stringify(acceptance.queryDates))throw Error('Map and acceptance query dates differ');
 if(!Array.isArray(browserResults)||browserResults.length>30)throw Error('Browser results must be a bounded array');
 for(const x of browserResults){
  if(x?.mapSha256&&x.mapSha256!==mapSha256)throw Error('Stale browser evidence: map hash differs');
  if(x?.status!==data.status)throw Error('Browser evidence delivery status differs');
 }
 const checks=browserResults.map(x=>{
  const values=[x.overflow===false,x.buttonVisible===true,x.coveredPoints===0,x.outOfViewport===0,x.hiddenReferencePoints===0,x.pointsUnderControls===0,x.screenshotVisibility?.hidden===0,x.originalReferencePreserved===true,x.noteMatchesData===true,Array.isArray(x.pageErrors)&&x.pageErrors.length===0];
  const booleans=['overflow','buttonVisible','originalReferencePreserved','noteMatchesData'],numbers=['coveredPoints','outOfViewport','hiddenReferencePoints','pointsUnderControls'];
  let modeValues=[],modeMissing=false,modeFailure=false;
  if(gpxOnly){
   const required={mode:'gpx-only-reference',parts:0,points:0,topology:null,direction:null,total:'总里程待核实',tileUrlPresent:true,tileUrl:null,tileLayerCount:0,cueCount:0,keyCueCount:0,supplyCount:0,optionalRouteCount:0,turnCandidateCount:0,localRoadCount:0,researchMarkerCount:0,navigationRoutePartsPresent:false,actualStartPresent:false,actualEndPresent:false,tileAttributionPresent:false,pendingChecksHasUndefined:false,originalGpxSegments:originalSegments?.length??1,segmentLinks:0,nextLabel:'未生成导航终点',nextStatHidden:true,focusHidden:true};
   modeMissing=Object.keys(required).some(key=>!Object.hasOwn(x,key));
   modeValues=Object.entries(required).map(([key,value])=>Object.hasOwn(x,key)&&x[key]===value);
   modeFailure=Object.entries(required).some(([key,value])=>Object.hasOwn(x,key)&&x[key]!==value);
  }
  const missing=booleans.some(k=>typeof x[k]!=='boolean')||numbers.some(k=>!Number.isFinite(x[k]))||!Array.isArray(x.pageErrors)||!Number.isFinite(x.screenshotVisibility?.hidden)||modeMissing;
  const knownFailure=x.overflow===true||x.buttonVisible===false||x.originalReferencePreserved===false||x.noteMatchesData===false||numbers.some(k=>Number.isFinite(x[k])&&x[k]!==0)||Number.isFinite(x.screenshotVisibility?.hidden)&&x.screenshotVisibility.hidden!==0||Array.isArray(x.pageErrors)&&x.pageErrors.length>0||modeFailure;
  return {name:x.name??null,mapHashBound:x.mapSha256===mapSha256,status:knownFailure?'failed':values.every(Boolean)&&modeValues.every(Boolean)?'passed':missing?'not-tested':'failed',gpsSimulation:gpsCoverage(x,data.status)};
 });
 const named=new Set(checks.map(x=>x.name)),bound=checks.length>0&&checks.every(x=>x.mapHashBound);
 const browserStatus=checks.some(x=>x.status==='failed')?'failed':bound&&named.has('phone')&&named.has('desktop')&&checks.every(x=>x.status==='passed')?'passed':'not-tested';
 const softwareStatus=gpxOnly&&(gpxDataContract.status==='failed'||browserStatus==='failed')?'failed':gpxOnly&&(gpxDataContract.status!=='passed'||browserStatus!=='passed')?'not-tested':browserStatus;
 const issues=knownArray(acceptance.errors)??knownArray(acceptance.blockers);
 if(issues&&!issues.every(x=>typeof x==='string'))throw Error('Route issues must be source text, not inferred objects');
 const componentMappingComplete=acceptance.validLegCount===acceptance.legCount&&acceptance.legCount===safeRouteParts.length;
 const facts={generatedAt,mapSha256,scope:'Current artifact software/evidence report only; not general Skill, road-opening or physical device certification',
  skillGeneration:{status:softwareStatus,scope:'Current map layout, reference display and hash-bound browser checks only; GPS sample coverage reported separately',...(gpxOnly?{dataContract:gpxDataContract}:{}),viewports:checks,mapQaBinding:bound?'bound':'unbound'},
  routeRideability:{recordedMapStatus:data.status,status:data.status==='draft'?'not-accepted':'planning-record-only; not independently certified',usableTotalKm:data.totalKm??null,unresolvedItems:issues,recordedDeviceAcceptance:acceptance.reviewStatus?.deviceAcceptance?.status??(typeof acceptance.reviewStatus?.deviceAcceptance==='string'?acceptance.reviewStatus.deviceAcceptance:null),physicalDeviceVerifiedByThisTool:false},
  mileage:{compositionCandidateKm:numeric(acceptance.totalCandidateKm),navigationCandidateKm:numeric(acceptance.navigationTotalKm),usableTotalKm:data.totalKm??null,totalApproximate:typeof data.totalApproximate==='boolean'?data.totalApproximate:null,queryDates:acceptance.queryDates??[],warnings:knownArray(acceptance.warnings)??[],parts:safeRouteParts.map(distanceRecord),navigationSegments:safeNavSegments.map(distanceRecord)},
  pendingChecks:(knownArray(acceptance.reviewStatus?.pendingChecks)??[]).map(x=>({code:x.code??null,name:x.name??x.description??null,owner:x.owner??null,action:x.action??null})),
  deviceAcceptance:typeof acceptance.reviewStatus?.deviceAcceptance==='object'&&acceptance.reviewStatus.deviceAcceptance?{status:acceptance.reviewStatus.deviceAcceptance.status??null,owner:acceptance.reviewStatus.deviceAcceptance.owner??null,action:acceptance.reviewStatus.deviceAcceptance.action??null}:null,
  points:{originalGpx:originalPointCount,originalGpxSegments:originalSegments?.length??(knownArray(data.originalGpx?.points)?1:null),cues:knownArray(data.cues)?.length??null,keyPoints:knownArray(data.cues)?.filter(x=>x.kind==='key').length??null,supplies:knownArray(data.supplies)?.length??null,...(gpxOnly?{optionalRoutes:knownArray(data.optionalRoutes)?.length??null,localRoads:knownArray(data.localRoads)?.length??null,researchMarkers:knownArray(data.researchMarkers)?.length??null}:{}),turnCandidates:knownArray(data.turnCandidates)?.length??null,navigationSegments:safeNavSegments.length,approvedManualSwitches:data.status==='complete'?Math.max(0,safeNavSegments.length-1):null},
  comparisons:(acceptance.fidelityReports??[]).map(x=>({leg:x.leg,scope:x.comparisonScope??null,geometrySource:x.geometrySource??null,referenceSpanCount:x.referenceSpanCount??null,referenceGeometryKm:numeric(x.referenceGeometryKm),comparedGeometryKm:numeric(x.comparedGeometryKm),navigationDistanceKm:componentMappingComplete?numeric(safeRouteParts[x.leg-1]?.distanceKm):null,ratio:numeric(x.ratio),p95Metres:numeric(x.p95Metres),maxMetres:numeric(x.maxMetres)})),
  notEstablished:['当前道路开放与通行权限','真实手机App调起与物理GPS','在线详细底图和截图目视','完整工具尝试、失败、用户授权与账户状态']};
 const lines=['# 地图作业事实报告','',`报告生成时间：${md(generatedAt)}（不是导航查询时间）。`,`地图SHA256：${mapSha256}。`,'',
  '## Skill生成能力验收','',`本作业软件检查：${softwareStatus}${gpxOnly?'；GPX-only数据合同：'+gpxDataContract.status:''}；浏览器证据绑定：${facts.skillGeneration.mapQaBinding}；记录视口：${checks.length}。`,
  '该结论只针对当前产物和浏览器记录，不能代替不同起点、方向、路书的冻结包独立测试。截图实际目视、原始服务响应保真仍须独立核验。','',
  '## 具体路线可骑行验收','',`地图记录状态：${data.status}；具体路线独立认证：${md(facts.routeRideability.status)}。`,
  `可交付总里程：${data.totalKm===null?'未核实，保持空值':(data.totalApproximate?'约 ':'')+display(data.totalKm)+' km（仅依据当前组装记录）'}。`,
  '本工具不判定当前道路开放或授权状态，不证明真实手机App/GPS，也不把旧捕获称为本轮实时查询。','',
  '### 距离与来源','',`组成候选和：${display(facts.mileage.compositionCandidateKm)} km；导航候选和：${display(facts.mileage.navigationCandidateKm)} km。`,
  `原查询日期：${facts.mileage.queryDates.length?facts.mileage.queryDates.map(md).join('、'):'未记录'}。`,
  '候选里程与可交付里程分开；GPX/折线几何不是导航distance。未记录的数字不补造。','',
  '### 点位与切换','',`原GPX点：${display(facts.points.originalGpx)}；原GPX独立段：${display(facts.points.originalGpxSegments)}；地图关键点：${display(facts.points.keyPoints)}；补给：${display(facts.points.supplies)}；转向候选：${display(facts.points.turnCandidates)}。`,
  `导航段：${facts.points.navigationSegments}；已批准途中切换：${facts.points.approvedManualSwitches===null?'未批准':facts.points.approvedManualSwitches}。`,
  '这些是当前地图内的数据分类计数，不是本工具独立确认地点或营业事实。','',
  '### 比较范围与三种距离','',
  '| 段 | 比较范围 | 原参考几何km | 对照几何km | 导航distance km | 比例 | p95 m | max m | 几何来源 |',
  '|---|---|---|---|---|---|---|---|---|'];
 for(const c of facts.comparisons)lines.push(`| ${c.leg} | ${md(c.scope)} | ${display(c.referenceGeometryKm)} | ${display(c.comparedGeometryKm)} | ${display(c.navigationDistanceKm)} | ${display(c.ratio)} | ${display(c.p95Metres)} | ${display(c.maxMetres)} | ${md(c.geometrySource)} |`);
 if(!facts.comparisons.length)lines.push('| — | 未记录比较证据 | — | — | — | — | — | — | — |');
 lines.push('','显示比较值四舍五入到3位小数；report-data.json保留原值。partial范围不能解释成完整路段偏离，不能把几何km替换成导航distance。','',
  '### 路线未解决项','',...(issues?issues.length?issues.map(x=>'- '+md(x)):['组装报告未列未解决项；不等于现场或设备通过。']:['未记录该字段，不能假定零缺口。']),
  '', '### 网页距离与精度','',...facts.mileage.parts.concat(facts.mileage.navigationSegments).filter(p=>p.evidence?.type==='amap-mobile-web').map(p=>`- ${md(p.name)}：约 ${display(p.distanceKm)} km；原显示小数位 ${display(p.evidence.displayedDecimals)}；舍入规则 ${p.evidence.roundingRuleKnown===false?'未确认，累计误差未知':p.evidence.roundingRuleKnown===true?'已有记录（本工具不推定具体规则）':'未记录'}；显示标签 ${md(p.evidence.label)}。`),
  ...facts.mileage.warnings.map(w=>'- 来源警告：'+md(w)),
  '几何来源为 original-gpx、reviewed-road-geometry 或 local-road-candidate 时，是独立对照几何，不是网页导出的高德算路折线。','',
  '### 待核查责任与操作','',...facts.pendingChecks.map(x=>`- ${md(x.code)} / ${md(x.name)}；负责方：${md(x.owner)}；下一操作：${md(x.action)}。`),
  `设备验收记录：${md(facts.deviceAcceptance?.status??facts.routeRideability.recordedDeviceAcceptance)}；负责方：${md(facts.deviceAcceptance?.owner)}；操作：${md(facts.deviceAcceptance?.action)}。`,
  '', '### 定位自动选段模拟覆盖','',...checks.map(x=>`- ${md(x.name)}：${x.gpsSimulation.status}；已模拟 ${display(x.gpsSimulation.testedSamples)}，跳过 ${display(x.gpsSimulation.skippedSamples)}。`),
  ...checks.flatMap(x=>x.gpsSimulation.skipped.map(s=>`- ${md(x.name)} / 段 ${display(s.segment)} 跳过原因：${md(s.reason)}。`)),
  '布局通过不等于自动选段全覆盖；重叠路线跳过的样本不记作通过，模拟也不等于真实设备GPS。',
  '', '## 未建立的证据','',...facts.notEstablished.map(x=>'- '+md(x)),
  '', '本报告不包含完整工具历史；不宣称所有尝试均成功，也不根据当前运行范围猜测用户是否授权。授权与失败记录应由调用方另行保留。',
  '停车后操作地图；服从交通、天气预警、封路与现场标志。真实地图公开前先脱敏。','');
 return {facts,markdown:lines.join('\n')};
}

async function main(args){
 const allowed=new Set(['--map','--acceptance','--browser-results','--out-md','--out-json']),v={};
 for(let i=0;i<args.length;i+=2){if(!allowed.has(args[i])||args[i+1]===undefined||Object.hasOwn(v,args[i]))throw Error('Unknown, repeated or missing option');v[args[i]]=args[i+1];}
 for(const flag of allowed)if(!v[flag])throw Error('Missing '+flag);
 const input=['--map','--acceptance','--browser-results'].map(k=>path.resolve(v[k])),outputs=['--out-md','--out-json'].map(k=>path.resolve(v[k]));
 if(path.extname(outputs[0])!=='.md'||path.extname(outputs[1])!=='.json'||outputs[0]===outputs[1]||outputs.some(x=>input.includes(x)))throw Error('Use distinct new report .md/.json outputs');
 for(const f of outputs)if(await fs.stat(f).then(()=>true,()=>false))throw Error('Report output exists; preserve prior evidence');
 const [mapHtml,acceptance,browserResults]=await Promise.all(input.map(f=>fs.readFile(f,'utf8')));
 const {facts,markdown}=buildJobReport({mapHtml,acceptance:JSON.parse(acceptance),browserResults:JSON.parse(browserResults)});
 for(const f of outputs)await fs.mkdir(path.dirname(f),{recursive:true});
 await fs.writeFile(outputs[0],markdown,{flag:'wx'});await fs.writeFile(outputs[1],JSON.stringify(facts,null,2),{flag:'wx'});
 console.log(JSON.stringify({softwareStatus:facts.skillGeneration.status,routeStatus:facts.routeRideability.status,mapSha256:facts.mapSha256}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1});
