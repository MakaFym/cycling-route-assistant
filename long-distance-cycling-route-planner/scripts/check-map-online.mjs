import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const [file,out]=process.argv.slice(2);if(!file||!out)throw Error('Use check-map-online.mjs MAP.html PRIVATE_QA_DIR after tile-provider authorization');
const allowed=new Set(['webrd01.is.autonavi.com','webrd02.is.autonavi.com','webrd03.is.autonavi.com','webrd04.is.autonavi.com']);
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.MAP_TEST_CHROME?{executablePath:process.env.MAP_TEST_CHROME}:{})}),results=[];
try{
 for(const [name,width,height] of [['phone',390,844],['desktop',1440,1000]]){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(),tiles=[],pageErrors=[],blocked=new Set();
  await page.route('**/*',route=>{const u=new URL(route.request().url());if(u.protocol==='file:'||u.protocol==='data:'||(u.protocol==='https:'&&allowed.has(u.hostname)&&u.pathname==='/appmaptile'))return route.continue();blocked.add(u.hostname);return route.abort();});
  page.on('pageerror',e=>pageErrors.push(e.message));
  page.on('response',response=>{const u=new URL(response.url());if(allowed.has(u.hostname)&&u.pathname==='/appmaptile')tiles.push({zoom:Number(u.searchParams.get('z')),status:response.status(),imageType:response.headers()['content-type']?.startsWith('image/')===true});});
  await page.goto(pathToFileURL(path.resolve(file)).href);await page.waitForTimeout(1800);
  await page.screenshot({path:path.join(out,name+'-overview.png')});
  const overview=await page.evaluate(()=>({zoom:map.getZoom(),loaded:document.querySelectorAll('img.leaflet-tile-loaded').length}));
  await page.evaluate(()=>{const part=D.routeParts.find(p=>p.type==='main')||D.routeParts[0];const p=part.points[Math.floor(part.points.length/2)];map.setView(gcj(...p),17,{animate:false})});
  await page.waitForTimeout(2500);await page.screenshot({path:path.join(out,name+'-detail.png')});
  const detail=await page.evaluate(()=>({zoom:map.getZoom(),loaded:document.querySelectorAll('img.leaflet-tile-loaded').length}));
  const maximum=await page.evaluate(()=>{map.setZoom(19,{animate:false});return {defaultProvider:!D.tileUrl,zoom:map.getZoom(),maximum:map.getMaxZoom()}});
  await page.waitForTimeout(2500);await page.screenshot({path:path.join(out,name+'-maximum-detail.png')});
  const item={name,overview,detail,maximum,detailSuccessfulTiles:tiles.filter(x=>x.zoom===17&&x.status===200&&x.imageType).length,maximumSuccessfulTiles:tiles.filter(x=>x.zoom===maximum.zoom&&x.status===200&&x.imageType).length,failedTiles:tiles.filter(x=>x.status!==200||!x.imageType),blockedExternalHosts:[...blocked],pageErrors,visualDetailReviewRequired:true,deviceAppVerified:false};results.push(item);
  if(maximum.defaultProvider){assert.equal(maximum.zoom,18,'Default provider permits blank zoom19');assert.equal(maximum.maximum,18);assert.equal(tiles.some(x=>x.zoom===19),false,'Requested known blank zoom19');}
  assert.ok(item.maximumSuccessfulTiles>0,'Maximum-zoom image tiles did not load; inspect screenshots for actual detail');
  assert.equal(pageErrors.length,0,'Map runtime failed');assert.equal(detail.zoom,17);assert.ok(detail.loaded>0&&item.detailSuccessfulTiles>0,'High-zoom image tiles did not actually load');assert.equal(item.failedTiles.length,0,'Tile access/image failure');await context.close();
 }
}finally{await fs.writeFile(path.join(out,'online-results.json'),JSON.stringify(results,null,2));await browser.close();}
console.log(JSON.stringify({passed:true,results}));
