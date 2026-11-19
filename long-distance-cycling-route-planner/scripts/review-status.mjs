import {isEvidenceDate} from './evidence-dates.mjs';
const fields=[
 ['routeAndRoadsChecked','route-review','道路与GPX走廊','核对接驳、方向、主要道路和显著差异，记录实际依据'],
 ['navDeletionChecked','navigation-review','导航分段','核对最新分段的删除测试，合并冗余端点并说明短段理由'],
 ['accessChecked','access-review','入口与通行','先查道路属性、当前地图与合法入口；能避开疑点时改点重算，不直接推给骑手现场确认']
];
const owners=new Set(['agent','device','field','user-choice','account']);
export function reviewStatus(review={}){
 const evidenceValid=typeof review.evidence==='string'&&review.evidence.trim().length>=20&&isEvidenceDate(review.checkedAt);
 const checks=fields.map(([field,code,name,action])=>({code,name,passed:review[field]===true&&evidenceValid,owner:'agent',action,evidence:review[field]===true&&evidenceValid?review.evidence:null}));
 const pending=[];
 if(review.pendingChecks!=null){
  if(!Array.isArray(review.pendingChecks))throw Error('review.pendingChecks must be an array');
  for(const item of review.pendingChecks){
   if(!item?.code||typeof item.description!=='string'||item.description.trim().length<10||!owners.has(item.owner)||typeof item.action!=='string'||item.action.trim().length<10)throw Error('Each pending check needs code, concrete description, owner and action');
   pending.push({code:item.code,name:item.description,owner:item.owner,action:item.action});
  }
 }
 return {complete:checks.every(x=>x.passed)&&pending.length===0,evidenceValid,checks,pendingChecks:[...checks.filter(x=>!x.passed),...pending],
  deviceAcceptance:{status:'not-tested',owner:'device',action:'准备经授权的HTTPS手机入口后，实际验证定位授权与高德骑行调起；浏览器视口或API成功不算实机通过'}};
}
