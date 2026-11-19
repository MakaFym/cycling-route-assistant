import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RAD = Math.PI / 180;
const ROAD_TYPES = new Set(['primary','secondary','tertiary','unclassified','residential','living_street','service','cycleway','track','path','primary_link','secondary_link','tertiary_link']);

export function metres(a,b) {
  const d=(b[0]-a[0])*RAD, e=(b[1]-a[1])*RAD;
  const q=Math.sin(d/2)**2+Math.cos(a[0]*RAD)*Math.cos(b[0]*RAD)*Math.sin(e/2)**2;
  return 6371008.8*2*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));
}

export function parseGpxGeometry(xml) {
  // GPX-focused XML scanner: no DTD, external entities or schema validation.
  // Preserve element boundaries; comments/CDATA are never route geometry.
  if(typeof xml!=='string')throw Error('GPX XML text required');
  xml=xml.replace(/^\uFEFF/,'');
  const stack=[],segments=[],routes=[],looseTrack=[],looseRoute=[];let pos=0,roots=0,rootNamespace='';
  const decode=s=>s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,v)=>{
    const named={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
    if(v[0]!=='#')return named[v]??_;
    const code=v[1].toLowerCase()==='x'?parseInt(v.slice(2),16):Number(v.slice(1));
    if(!Number.isInteger(code)||code<1||code>0x10ffff||code>=0xd800&&code<=0xdfff)throw Error('Invalid GPX character reference');
    return String.fromCodePoint(code);
  });
  const coordinate=s=>{
    const value=typeof s==='string'?decode(s).trim():'';
    if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))throw Error('Invalid GPX point');
    return Number(value);
  };
  while(pos<xml.length){
    const start=xml.indexOf('<',pos);
    if(start<0){if(!stack.length&&xml.slice(pos).trim())throw Error('Malformed GPX XML outside root');break;}
    if(!stack.length&&xml.slice(pos,start).trim())throw Error('Malformed GPX XML outside root');
    if(xml.startsWith('<!--',start)){
      const end=xml.indexOf('-->',start+4);if(end<0||xml.slice(start+4,end).includes('--'))throw Error('Malformed GPX comment');pos=end+3;continue;
    }
    if(xml.startsWith('<![CDATA[',start)){
      const end=xml.indexOf(']]>',start+9);if(end<0||!stack.length)throw Error('Malformed GPX CDATA');pos=end+3;continue;
    }
    if(xml.startsWith('<?',start)){const end=xml.indexOf('?>',start+2);if(end<0)throw Error('Malformed GPX processing instruction');pos=end+2;continue;}
    if(xml.startsWith('<!',start))throw Error('GPX DTD/declarations unsupported; export plain GPX without entities');
    let end=start+1,quote='';
    for(;end<xml.length;end++){const c=xml[end];if(quote){if(c===quote)quote='';}else if(c==='"'||c==="'")quote=c;else if(c==='>')break;}
    if(end===xml.length)throw Error('Malformed GPX XML tag or quote');
    let body=xml.slice(start+1,end);pos=end+1;
    if(body.startsWith('/')){const name=body.slice(1).trim();if(!stack.length||stack.at(-1).name!==name)throw Error('Malformed GPX XML nesting');stack.pop();continue;}
    const self=body.endsWith('/');if(self)body=body.slice(0,-1);
    const first=body.match(/^([\p{L}_][\p{L}\p{N}\p{M}_.:-]*)/u);if(!first)throw Error('Malformed GPX XML element');
    const name=first[1],local=name.split(':').at(-1),attrs=Object.create(null);let tail=body.slice(name.length);
    while(tail.trim()){
      const a=tail.match(/^\s+([\p{L}_][\p{L}\p{N}\p{M}_.:-]*)\s*=\s*(["'])([\s\S]*?)\2/u);
      if(!a||Object.hasOwn(attrs,a[1])||a[3].includes('<'))throw Error('Malformed GPX XML attribute');attrs[a[1]]=a[3];tail=tail.slice(a[0].length);
    }
    const namespaces={...(stack.at(-1)?.namespaces??{xml:'http://www.w3.org/XML/1998/namespace'})};
    for(const [key,value] of Object.entries(attrs)){if(key==='xmlns')namespaces['']=decode(value);else if(key.startsWith('xmlns:'))namespaces[key.slice(6)]=decode(value);}
    const pieces=name.split(':');if(pieces.length>2||pieces.length===2&&(!Object.hasOwn(namespaces,pieces[0])||!namespaces[pieces[0]]))throw Error('Malformed GPX XML namespace prefix');
    const namespace=pieces.length===2?namespaces[pieces[0]]:namespaces['']??'';
    if(!stack.length){if(local!=='gpx'||++roots>1||!['','http://www.topografix.com/GPX/1/1','http://www.topografix.com/GPX/1/0'].includes(namespace))throw Error('GPX needs a single supported gpx root');rootNamespace=namespace;}
    const node={name,local,namespace,namespaces,isGpx:namespace===rootNamespace,points:[]},parent=stack.at(-1);
    if(node.isGpx&&['trk','trkseg','rte'].includes(local)){
      const expected=local==='trkseg'?'trk':'gpx';
      if(!parent?.isGpx||parent.local!==expected)throw Error('GPX track/route container outside supported parent structure');
      if(local==='trkseg')segments.push(node);if(local==='rte')routes.push(node);
    }
    if(node.isGpx&&(local==='trkpt'||local==='rtept')){
      const p=[coordinate(attrs.lat),coordinate(attrs.lon)];
      if(!p.every(Number.isFinite)||Math.abs(p[0])>90||Math.abs(p[1])>180)throw Error('Invalid GPX point');
      const kind=local==='trkpt'?'trkseg':'rte';
      if(parent?.isGpx&&parent.local===kind)parent.points.push(p);
      else if(parent?.isGpx&&parent.local==='gpx')(local==='trkpt'?looseTrack:looseRoute).push(p);
      else throw Error('GPX point outside a supported track/route container');
    }
    if(!self)stack.push(node);
  }
  if(stack.length||roots!==1)throw Error('Malformed GPX XML: unclosed root or segment');
  const tracks=segments.filter(x=>x.points.length).map(x=>x.points),activeRoutes=routes.filter(x=>x.points.length).map(x=>x.points);
  const hasTracks=tracks.length||looseTrack.length,hasRoutes=activeRoutes.length||looseRoute.length;
  if(hasTracks&&hasRoutes||tracks.length&&looseTrack.length||activeRoutes.length&&looseRoute.length)throw Error('Multiple GPX source kinds require explicit selection; never concatenate tracks and routes');
  const sourceKind=hasTracks?'track':hasRoutes?'route':null;
  const parts=tracks.length?tracks:looseTrack.length?[looseTrack]:activeRoutes.length?activeRoutes:looseRoute.length?[looseRoute]:[];
  if(!parts.length||parts.length===1&&parts[0].length<2)throw Error('GPX needs at least two track or route points');
  if(parts.some(points=>points.length<2))throw Error('Multiple GPX segments/routes contain an underspecified part; never concatenate disconnected tracks');
  return {
    sourceKind,
    namespace:rootNamespace||null,
    version:rootNamespace.endsWith('/1/0')?'1.0':rootNamespace.endsWith('/1/1')?'1.1':null,
    segments:parts.map(points=>points.map(point=>[...point]))
  };
}

export function parseGpx(xml) {
  const parsed=parseGpxGeometry(xml);
  if(parsed.segments.length>1)throw Error('Multiple GPX segments/routes require explicit selection; never concatenate disconnected tracks');
  return parsed.segments[0];
}

function gcj(p) {
  const [lat,lng]=p;
  if(lng<72.004||lng>137.8347||lat<.8293||lat>55.8271) return p;
  const x=lng-105,y=lat-35;
  let a=-100+2*x+3*y+.2*y*y+.1*x*y+.2*Math.sqrt(Math.abs(x));
  let b=300+x+2*y+.1*x*x+.1*x*y+.1*Math.sqrt(Math.abs(x));
  a+=(20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3+(20*Math.sin(y*Math.PI)+40*Math.sin(y/3*Math.PI))*2/3+(160*Math.sin(y/12*Math.PI)+320*Math.sin(y*Math.PI/30))*2/3;
  b+=(20*Math.sin(6*x*Math.PI)+20*Math.sin(2*x*Math.PI))*2/3+(20*Math.sin(x*Math.PI)+40*Math.sin(x/3*Math.PI))*2/3+(150*Math.sin(x/12*Math.PI)+300*Math.sin(x*Math.PI/30))*2/3;
  const e=.00669342162296594323,A=6378245,s=Math.sin(lat*RAD),m=1-e*s*s,k=Math.sqrt(m);
  return [lat+a*180/((A*(1-e))/(m*k)*Math.PI),lng+b*180/(A/k*Math.cos(lat*RAD)*Math.PI)];
}

export function gcjToWgs(p) {
  let x=[...p];
  for(let i=0;i<6;i++){const q=gcj(x);x=[x[0]+p[0]-q[0],x[1]+p[1]-q[1]]}
  return x;
}

function percentile(values) {
  const s=[...values].sort((a,b)=>a-b);
  return {median:s[Math.floor(s.length*.5)],p95:s[Math.floor(s.length*.95)],max:s.at(-1),over100m:s.filter(x=>x>100).length};
}

class Heap {
  items=[];
  push(v){const a=this.items;a.push(v);let i=a.length-1;while(i){const p=(i-1)>>1;if(a[p][0]<=v[0])break;a[i]=a[p];i=p}a[i]=v}
  pop(){const a=this.items,v=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&a[j+1][0]<a[j][0])j++;if(a[j][0]>=last[0])break;a[i]=a[j];i=j}a[i]=last}return v}
}

export function buildRoadNetwork(osm) {
  if(!Array.isArray(osm?.elements)||osm.elements.some(x=>!['node','way','relation'].includes(x.type))) throw Error('Expected raw OSM elements');
  const vertices=[], vertexIds=new Map(), edges=[], grid=new Map(), excluded={};
  const cell=.003, key=(a,b)=>a+','+b;
  function vertex(p){const k=p[0].toFixed(7)+','+p[1].toFixed(7);if(!vertexIds.has(k)){vertexIds.set(k,vertices.length);vertices.push(p)}return vertexIds.get(k)}
  let uncertainWays=0;
  for(const way of osm.elements){
    const t=way.tags||{},h=t.highway;
    if(way.type!=='way'||!h||!Array.isArray(way.geometry)||way.geometry.length<2)continue;
    const prohibited=['no','private'].includes(t.bicycle)||(['no','private'].includes(t.access)&&!['yes','designated','permissive'].includes(t.bicycle));
    const allowed=ROAD_TYPES.has(h)||(h==='footway'&&['yes','designated'].includes(t.bicycle));
    if(prohibited||!allowed){excluded[h]=(excluded[h]||0)+1;continue}
    const uncertain=['track','path'].includes(h)&&!['yes','designated','permissive'].includes(t.bicycle);
    if(uncertain)uncertainWays++;
    for(let i=1;i<way.geometry.length;i++){
      const a=[way.geometry[i-1].lat,way.geometry[i-1].lon],b=[way.geometry[i].lat,way.geometry[i].lon];
      if(!a.concat(b).every(Number.isFinite)||metres(a,b)<.01)continue;
      const edge={a:vertex(a),b:vertex(b),tags:t,wayId:way.id,length:metres(a,b),uncertain,splits:[]},ei=edges.length;
      edges.push(edge);
      for(let y=Math.floor(Math.min(a[0],b[0])/cell);y<=Math.floor(Math.max(a[0],b[0])/cell);y++)
        for(let x=Math.floor(Math.min(a[1],b[1])/cell);x<=Math.floor(Math.max(a[1],b[1])/cell);x++){
          const k=key(y,x);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(ei);
        }
    }
  }
  if(!edges.length)throw Error('No candidate cycling road edges');
  function snap(p,insert=false){
    const y=Math.floor(p[0]/cell),x=Math.floor(p[1]/cell);let best={distance:Infinity};
    for(let r=0;r<5;r++){
      const seen=new Set();
      for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++)for(const ei of grid.get(key(y+dy,x+dx))||[]){
        if(seen.has(ei))continue;seen.add(ei);
        const edge=edges[ei],a=vertices[edge.a],b=vertices[edge.b];
        const sx=111320*Math.cos(p[0]*RAD),sy=110540,vx=(b[1]-a[1])*sx,vy=(b[0]-a[0])*sy;
        const t=Math.max(0,Math.min(1,((p[1]-a[1])*sx*vx+(p[0]-a[0])*sy*vy)/(vx*vx+vy*vy)));
        const q=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])],distance=metres(p,q);
        if(distance<best.distance)best={distance,point:q,t,ei};
      }
      if(best.distance<100)break;
    }
    if(!Number.isFinite(best.distance))throw Error('Point outside supplied road coverage');
    if(insert){best.id=vertex(best.point);edges[best.ei].splits.push(best)}
    return best;
  }
  function graph(){
    const adj=Array.from({length:vertices.length},()=>[]);
    for(const e of edges){
      const steps=[{t:0,id:e.a},...e.splits,{t:1,id:e.b}].sort((a,b)=>a.t-b.t);
      for(let i=1;i<steps.length;i++){
        const a=steps[i-1].id,b=steps[i].id;if(a===b)continue;
        const d=metres(vertices[a],vertices[b]),bike=e.tags['oneway:bicycle'];
        const one=bike==='no'?false:bike==='yes'||['yes','1','true','-1'].includes(e.tags.oneway)||e.tags.junction==='roundabout';
        const reverse=e.tags.oneway==='-1';
        if(!one||!reverse)adj[a].push({to:b,d,uncertain:e.uncertain});
        if(!one||reverse)adj[b].push({to:a,d,uncertain:e.uncertain});
      }
    }
    return adj;
  }
  return {vertices,edges,excluded,uncertainWays,snap,graph};
}

export function shortest(adj,vertices,start,end,includeGeometry=false) {
  if(start===end)return {distance:0,unknownRightsEdges:0,...(includeGeometry?{points:[vertices[start]]}:{})};
  const dist=new Map([[start,0]]),prev=new Map(),heap=new Heap();
  heap.push([metres(vertices[start],vertices[end]),start,0]);
  while(heap.items.length){
    const [,u,d]=heap.pop();if(d!==dist.get(u))continue;
    if(u===end){let unknownRightsEdges=0,v=end,ids=[end];while(v!==start){const p=prev.get(v);if(p.uncertain)unknownRightsEdges++;v=p.from;ids.push(v)}return {distance:d,unknownRightsEdges,...(includeGeometry?{points:ids.reverse().map(i=>vertices[i])}:{})}}
    for(const e of adj[u]){
      const nd=d+e.d;
      if(nd<(dist.get(e.to)??Infinity)){dist.set(e.to,nd);prev.set(e.to,{from:u,uncertain:e.uncertain});heap.push([nd+metres(vertices[e.to],vertices[end]),e.to,nd])}
    }
  }
  return null;
}

export function diagnose(gpxPoints,osm,start,options={}) {
  if(gpxPoints.length<2||start.length!==2||!start.every(Number.isFinite))throw Error('Invalid route inputs');
  const roads=buildRoadNetwork(osm);
  const coordTests={
    WGS84:percentile(gpxPoints.map(p=>roads.snap(p).distance)),
    GCJ02:percentile(gpxPoints.map(p=>roads.snap(gcjToWgs(p)).distance))
  };
  const gpxCrs=options.gpxCrs||'auto';
  if(!['auto','wgs84','gcj02'].includes(gpxCrs))throw Error('gpxCrs must be auto, wgs84 or gcj02');
  const selected=gpxCrs==='auto'?(coordTests.WGS84.median*2<coordTests.GCJ02.median?'WGS84':coordTests.GCJ02.median*2<coordTests.WGS84.median?'GCJ02':'ambiguous'):gpxCrs.toUpperCase();
  const points=selected==='GCJ02'?gpxPoints.map(gcjToWgs):gpxPoints;
  const indices=[0];let distance=0;
  for(let i=1;i<points.length;i++){distance+=metres(points[i-1],points[i]);if(distance>=(options.anchorMetres||350)||i===points.length-1){indices.push(i);distance=0}}
  const anchors=indices.map(i=>({...roads.snap(points[i],true),index:i}));
  const startWgs=options.startCrs==='gcj02'?gcjToWgs(start):start;
  if(options.startCrs&&!['wgs84','gcj02'].includes(options.startCrs))throw Error('startCrs must be wgs84 or gcj02');
  const origin=roads.snap(startWgs,true),adj=roads.graph();
  const route=(a,b)=>shortest(adj,roads.vertices,a,b);
  const gaps=[],detours=[],legs=[];let length=0;
  const ratio=options.detourRatio||1.6,snapLimit=options.snapMetres||100;
  for(let i=1;i<anchors.length;i++){
    const a=anchors[i-1],b=anchors[i],r=route(a.id,b.id);let original=0;
    for(let j=a.index+1;j<=b.index;j++)original+=metres(points[j-1],points[j]);
    if(!r)gaps.push({from:a.index,to:b.index,reason:'directed road graph disconnected'});
    else{
      const excessive=r.distance>original*ratio+100,far=a.distance>snapLimit||b.distance>snapLimit;
      if(excessive||far)detours.push({from:a.index,to:b.index,gpxMetres:original,roadMetres:r.distance,snapMetres:Math.max(a.distance,b.distance),reason:excessive?'road detour':'anchor too far from road'});
      length+=r.distance;
    }
    legs.push(r);
  }
  const closure=route(anchors.at(-1).id,anchors[0].id);
  const candidates=[];
  for(let i=0;i<anchors.length;i+=Math.max(1,Math.floor(anchors.length/25))){
    const outbound=route(origin.id,anchors[i].id),returnTrip=route(anchors[i].id,origin.id);
    if(outbound&&returnTrip)candidates.push({gpxIndex:anchors[i].index,outboundKm:outbound.distance/1000,returnKm:returnTrip.distance/1000,unknownRightsEdges:outbound.unknownRightsEdges+returnTrip.unknownRightsEdges});
  }
  candidates.sort((a,b)=>(a.outboundKm+a.returnKm)-(b.outboundKm+b.returnKm));
  const originalKm=gpxPoints.slice(1).reduce((sum,p,i)=>sum+metres(gpxPoints[i],p),0)/1000;
  const completeGraphCandidate=gaps.length===0&&!!closure&&candidates.length>0;
  return {
    status:'draft',deliverable:false,
    warning:'This is a local OSM road-network diagnostic, not an AMap cycling result or a legally verified route.',
    source:{osmTimestamp:osm.osm3s?.timestamp_osm_base||null,gpxPointCount:gpxPoints.length,osmElementCount:osm.elements.length},
    distance:{originalGpxGeometryKm:originalKm,rawGraphSumKm:completeGraphCandidate?(length+closure.distance+(candidates[0].outboundKm+candidates[0].returnKm)*1000)/1000:null,usableTotalKm:null},
    coordinates:{selectedHypothesis:selected,confirmed:false,hypotheses:coordTests},
    roadGraph:{vertices:roads.vertices.length,edges:roads.edges.length,excluded:roads.excluded,unknownRightsWayCount:roads.uncertainWays},
    originSnapMetres:origin.distance,anchorCount:anchors.length,anchorSnap:percentile(anchors.map(a=>a.distance)),
    gaps,detours,detourCount:detours.length,closureCandidateKm:closure?.distance/1000??null,
    accessCandidates:candidates.slice(0,5),candidateContinuous:completeGraphCandidate,
    accepted:false,acceptanceBlockers:[
      ...(selected==='ambiguous'?['GPX coordinate system ambiguous']:[]),
      ...(gaps.length?['road graph gaps']:[]),
      ...(detours.length?['detours or distant road snaps']:[]),
      'road access and current closures not verified',
      'AMap cycling segments and distances not verified'
    ]
  };
}

async function main(args) {
  const values={};
  for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith('--')||args[i+1]===undefined)throw Error('Use --gpx FILE --osm FILE --start LAT,LON --start-crs wgs84|gcj02 --out FILE');values[args[i].slice(2)]=args[i+1]}
  for(const name of ['gpx','osm','start','out'])if(!values[name])throw Error('Missing --'+name);
  if(!values['start-crs'])throw Error('Specify --start-crs wgs84 or gcj02');
  const start=values.start.split(',').map(Number);
  const xml=await fs.readFile(values.gpx,'utf8'),osm=JSON.parse(await fs.readFile(values.osm,'utf8'));
  const result=diagnose(parseGpx(xml),osm,start,{gpxCrs:values['gpx-crs']||'auto',startCrs:values['start-crs']});
  await fs.mkdir(path.dirname(values.out),{recursive:true});
  await fs.writeFile(values.out,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({status:result.status,gaps:result.gaps.length,detours:result.detourCount,usableTotalKm:result.distance.usableTotalKm,out:values.out}));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1});
}
