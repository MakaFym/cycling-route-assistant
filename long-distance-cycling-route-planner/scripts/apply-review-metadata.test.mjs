import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {applyReviewMetadata} from './apply-review-metadata.mjs';
const manifest={actualStart:[31,121],actualEnd:[31,121],queriedAt:'2026-10-12',originalGpx:{points:[[31,121],[31.01,121]]},legs:[{type:'outbound',start:[31,121],end:[31.01,121],referencePoints:[[31,121],[31.01,121]],responseFile:'captures/leg-01.json',queriedAt:'2026-10-12'}],removalTests:[],review:{routeAndRoadsChecked:false,navDeletionChecked:false,accessChecked:false}};
test('small indexed metadata updates preserve all original route evidence and input',()=>{
 const before=JSON.stringify(manifest),r=applyReviewMetadata(manifest,{title:'测试路线',legs:[{index:1,name:'接入点',endMandatory:true,mandatoryKind:'route_join',mandatoryEvidence:'原始去程响应终点与原GPX对应区间接入点一致，仅说明计划边界。'}],review:{pendingChecks:[{code:'entry',description:'入口路权与实际通行结构尚未核对完成',owner:'agent',action:'继续查地图入口和适用道路资料，不靠API成功批准'}]}});
 assert.equal(JSON.stringify(manifest),before);assert.deepEqual(r.originalGpx,manifest.originalGpx);
 for(const k of ['actualStart','actualEnd','queriedAt','removalTests'])assert.deepEqual(r[k],manifest[k]);
 for(const k of ['start','end','referencePoints','responseFile','queriedAt','type'])assert.deepEqual(r.legs[0][k],manifest.legs[0][k]);
 assert.equal(r.review.routeAndRoadsChecked,false);assert.equal(r.review.pendingChecks[0].owner,'agent');
});
test('geometry, capture, date, index manipulation and prototype fields are rejected',()=>{
 for(const p of [{originalGpx:{}},{legs:[{index:1,responseFile:'other.json'}]},{legs:[{index:1,start:[0,0]}]},{legs:[{index:1,referencePoints:[]}]},{queriedAt:'2026-10-13'},{legs:[{index:0}]},{legs:[{index:1},{index:1}]},JSON.parse('{"__proto__":{}}')])assert.throws(()=>applyReviewMetadata(manifest,p));
});
test('approval metadata needs dated evidence; no device acceptance or status override',()=>{
 for(const p of [{review:{routeAndRoadsChecked:true}},{review:{accessChecked:'true'}},{review:{deviceAcceptance:'passed'}},{status:'complete'},{legs:[{index:1,endMandatory:true,mandatoryKind:'turn',mandatoryEvidence:'这是一个很长很长很长但是不是计划边界的说明'}]},{legs:[{index:1,alignmentReview:{checked:true,checkedAt:'2026-02-30',outcome:'same-corridor',evidence:'这是一个需要足够字数但日期不合法的道路审核说明'}}]}])assert.throws(()=>applyReviewMetadata(manifest,p));
});
test('CLI writes a sibling without changing source and refuses overwrite or relocated captures',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cycling-metadata-')),script=fileURLToPath(new URL('./apply-review-metadata.mjs',import.meta.url)),mf=path.join(dir,'manifest.json'),patch=path.join(dir,'patch.json'),out=path.join(dir,'reviewed.json');
 try{
  const original=JSON.stringify(manifest);await fs.writeFile(mf,original);await fs.writeFile(patch,JSON.stringify({note:'停好车再查看地图。'}));
  const run=o=>spawnSync(process.execPath,[script,'--manifest',mf,'--patch',patch,'--out',o],{encoding:'utf8'});
  assert.equal(run(out).status,0);assert.equal(await fs.readFile(mf,'utf8'),original);assert.equal(run(out).status,1);assert.equal(run(mf).status,1);assert.equal(run(path.join(dir,'elsewhere/reviewed.json')).status,1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
