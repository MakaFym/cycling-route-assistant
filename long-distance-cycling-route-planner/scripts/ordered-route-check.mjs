import {metres} from './diagnose-osm-route.mjs';

function samples(points){
  if(!Array.isArray(points)||points.length<2||!points.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180))throw Error('Ordered check needs valid WGS-84 points');
  const lengths=points.slice(1).map((p,i)=>metres(points[i],p));
  const total=lengths.reduce((s,d)=>s+d,0);
  if(total<=0)throw Error('Ordered check cannot certify zero-length route');
  // Bound the dynamic-programming grid without silently weakening its resolution.
  const spacing=Math.max(40,total/3998);
  if(spacing>75)throw Error('Ordered check needs smaller route spans; sampling would be too coarse');
  const out=[points[0]];let traversed=0,next=spacing;
  for(let i=0;i<lengths.length;i++){
    const length=lengths[i],a=points[i],b=points[i+1];
    while(length>0&&next<traversed+length){
      const t=(next-traversed)/length;out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);next+=spacing;
    }
    traversed+=length;
  }
  out.push(points.at(-1));return {points:out,spacing};
}

export function orderedRouteCheck(reference,actual){
  const a=samples(reference),b=samples(actual);
  const lat=(reference[0][0]+actual[0][0])/2;
  const sx=111320*Math.cos(lat*Math.PI/180),sy=110540;
  const origin=reference[0];
  const xy=p=>[(p[1]-origin[1])*sx,(p[0]-origin[0])*sy];
  const aa=a.points.map(xy),bb=b.points.map(xy);
  let previous=new Float64Array(bb.length).fill(Infinity);
  const columnNearest=new Float64Array(bb.length).fill(Infinity);let footprintDistance=0;
  for(let i=0;i<aa.length;i++){
    const row=new Float64Array(bb.length).fill(Infinity);
    let rowNearest=Infinity;
    for(let j=0;j<bb.length;j++){
      const d=Math.hypot(aa[i][0]-bb[j][0],aa[i][1]-bb[j][1]);
      rowNearest=Math.min(rowNearest,d);columnNearest[j]=Math.min(columnNearest[j],d);
      const before=i===0&&j===0?0:Math.min(i?previous[j]:Infinity,j?row[j-1]:Infinity,i&&j?previous[j-1]:Infinity);
      row[j]=Math.max(d,before);
    }
    footprintDistance=Math.max(footprintDistance,rowNearest);
    previous=row;
  }
  footprintDistance=Math.max(footprintDistance,...columnNearest);
  const distance=previous.at(-1);
  const returnsToEndpointBeforeFinish=points=>{
    let left=false;
    const limit=Math.floor((points.length-1)*.85);
    for(let i=1;i<=limit;i++){
      const d=metres(points[0],points[i]);
      if(d>=150)left=true;
      else if(left&&d<=50)return true;
    }
    return false;
  };
  const endpointReturnAnomaly=returnsToEndpointBeforeFinish(b.points)||returnsToEndpointBeforeFinish([...b.points].reverse());
  return {orderedDistanceMetres:distance,orderCompatible:distance<=150,
    sampledFootprintDistanceMetres:footprintDistance,orderExcessMetres:Math.max(0,distance-footprintDistance),
    orderAnomalyScreen:distance>footprintDistance+300,endpointReturnAnomaly,
    sampleSpacingMetres:Math.max(a.spacing,b.spacing),referenceSamples:aa.length,actualSamples:bb.length,
    basis:'Discrete monotone route alignment with uniform distance samples; screening, not road-access proof'};
}
