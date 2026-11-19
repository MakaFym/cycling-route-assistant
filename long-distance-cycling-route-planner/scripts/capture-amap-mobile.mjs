import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {wgsToGcj} from './fetch-amap-bicycle.mjs';
import {parseVisibleMobileRide} from './amap-web-evidence.mjs';
export {parseVisibleMobileRide} from './amap-web-evidence.mjs';

export function mobileNavigationUri(leg){
  const valid=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180;
  if(!valid(leg?.start)||!valid(leg?.end))throw Error('Explicit valid WGS-84 endpoints required');
  const format=(p,name)=>{const q=wgsToGcj(p);return q[1].toFixed(6)+','+q[0].toFixed(6)+','+name};
  const url=new URL('https://uri.amap.com/navigation');
  for(const [k,v] of Object.entries({from:format(leg.start,leg.startName||'起点候选'),to:format(leg.end,leg.endName||'终点候选'),
    mode:'ride',callnative:'0',src:'codex.cycling.planner.test'}))url.searchParams.set(k,v);
  return url;
}

async function main(args){
  const get=k=>{const i=args.indexOf(k);return i<0?null:args[i+1]};
  if(!args.includes('--send-segment-endpoints-to-amap'))throw Error('Requires authorization for segment endpoints to AMap');
  const input=get('--manifest'),out=get('--out-dir');
  if(!input||!out)throw Error('Use --manifest FILE --out-dir PRIVATE_DIR --send-segment-endpoints-to-amap');
  const manifest=JSON.parse(await fs.readFile(input,'utf8'));
  if(!Array.isArray(manifest.legs)||!manifest.legs.length)throw Error('Manifest needs ordered legs');
  const require=createRequire(import.meta.url);
  const {chromium,devices}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
  const browser=await chromium.launch({headless:true,...(process.env.MAP_TEST_CHROME?{executablePath:process.env.MAP_TEST_CHROME}:{})});
  const context=await browser.newContext({...devices['Pixel 7']});
  await fs.mkdir(out,{recursive:true});const results=[];
  try{
    for(let i=0;i<manifest.legs.length;i++){
      const leg=manifest.legs[i],id='query-'+String(i+1).padStart(2,'0'),page=await context.newPage();
      const record={id,name:leg.name||id,kind:leg.kind||'candidate-leg',start:leg.start,end:leg.end,
        queriedAt:new Date().toISOString(),requestedUri:mobileNavigationUri(leg).href,status:'failed'};
      try{
        await page.goto(record.requestedUri,{waitUntil:'domcontentloaded',timeout:30000});
        await page.getByText('详情 >',{exact:true}).waitFor({timeout:12000});
        await page.waitForTimeout(500);
        record.map=await page.evaluate(()=>({url:location.href,title:document.title,text:document.body.innerText}));
        record.mapScreenshot=id+'-map.png';await page.screenshot({path:path.join(out,record.mapScreenshot)});
        await page.getByText('详情 >',{exact:true}).click();
        await page.waitForFunction(()=>location.pathname.startsWith('/navigation/ridedetail/')&&document.querySelector('.ride_detail .path .title'),{},{timeout:12000});
        record.details=await page.evaluate(()=>({url:location.href,title:document.title,text:document.body.innerText,
          steps:[...document.querySelectorAll('.ride_detail .path .title')].filter(x=>x.getBoundingClientRect().width).map(x=>x.textContent.trim())}));
        const summary=record.details.text.split('\n').map(x=>x.trim()).find(x=>/^(?:(\d+)小时)?(?:(\d+)分钟)?([0-9]+(?:\.[0-9]+)?)(公里|米)$/.test(x));
        record.parsed=parseVisibleMobileRide({mapUrl:record.map.url,detailUrl:record.details.url,title:record.details.title,summaryLabel:summary,steps:record.details.steps});
        record.status=record.parsed.status;
        record.detailsScreenshot=id+'-details.png';await page.screenshot({path:path.join(out,record.detailsScreenshot),fullPage:true});
      }catch(e){record.error=e.message;await page.screenshot({path:path.join(out,id+'-failed.png')}).catch(()=>{})}
      await fs.writeFile(path.join(out,id+'.json'),JSON.stringify(record,null,2));results.push(record);
      console.log(JSON.stringify({id,status:record.status,summary:record.parsed?.summaryLabel}));
      await page.close();
    }
    await fs.writeFile(path.join(out,'capture-report.json'),JSON.stringify({status:'research-only',usableTotalKm:null,
      successCount:results.filter(r=>r.status==='captured-not-accepted').length,results},null,2));
  }finally{await context.close();await browser.close()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1});
}
