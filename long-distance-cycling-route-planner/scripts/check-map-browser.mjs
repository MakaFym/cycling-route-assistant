import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

// Optional browser QA: install Playwright in the test environment, not in the Skill archive.
const require=createRequire(import.meta.url);
const pageFile=process.argv[2],outDir=process.argv[3];
if(!pageFile||!outDir)throw Error('Use node check-map-browser.mjs MAP.html PRIVATE_QA_DIR');
await fs.mkdir(outDir,{recursive:true});
if((await fs.readdir(outDir)).length)throw Error('QA output directory must be new or empty; preserve prior evidence');
const qaStartedAt=new Date().toISOString();
let mapSha256,browser,failureStage='map-input';
try{
  try{mapSha256=createHash('sha256').update(await fs.readFile(pageFile)).digest('hex')}
  catch(e){throw Error('Cannot read map HTML at "'+pageFile+'". Verify that MAP.html exists and is readable: '+e.message)}
  failureStage='browser-dependency';
  const playwrightModule=process.env.PLAYWRIGHT_MODULE||'playwright';
  let chromium;
  try{({chromium}=require(playwrightModule))}
  catch(e){throw Error('Cannot load optional Playwright test runtime "'+playwrightModule+'". Install it in the test environment or set PLAYWRIGHT_MODULE to an existing local Playwright module; the Skill does not bundle or install it automatically. '+e.message)}
  if(!chromium?.launch)throw Error('Playwright test runtime "'+playwrightModule+'" does not export chromium.launch. Set PLAYWRIGHT_MODULE to a compatible installed module.');
  failureStage='browser-launch';
  browser=await chromium.launch({
    headless:true,...(process.env.MAP_TEST_CHROME?{executablePath:process.env.MAP_TEST_CHROME}:{})
  });
  failureStage='browser-qa';
  const results=[];
  for(const [name,width,height] of [['phone',390,844],['compact',320,568],['phone-small',360,640],['phone-medium',375,667],['tablet',768,1024],['landscape',844,390],['desktop',1440,1000]]){
    const context=await browser.newContext({viewport:{width,height},offline:true});
    const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.stack||e.message));
    await page.goto(pathToFileURL(path.resolve(pageFile)).href);
    try{await page.waitForFunction(()=>typeof L!=='undefined'&&document.getElementById('title').textContent)}
    catch(e){
      await page.screenshot({path:path.join(outDir,name+'-failed.png')}).catch(()=>{});
      await fs.writeFile(path.join(outDir,name+'-failure.json'),JSON.stringify({message:e.message,pageErrors:errors,
        text:await page.locator('body').innerText().catch(()=>''),url:page.url()},null,2));
      throw Error('Map startup failed: '+errors.join('; ')+'; '+e.message);
    }
    await page.waitForTimeout(600);
    const info=await page.evaluate(()=>{
      const r=document.querySelector('.panel').getBoundingClientRect();
      const b=document.getElementById('nextAmap').getBoundingClientRect();
      const state=document.getElementById('state').getBoundingClientRect();
      const coordinates=(D.navigationRouteParts||D.routeParts).flatMap(p=>p.points||[]).map(p=>map.latLngToContainerPoint(gcj(...p)));
      const references=(D.referenceRoutes||[]).flatMap(p=>p.points||[]).map(p=>map.latLngToContainerPoint(gcj(...p)));
      const controls=[...document.querySelectorAll('.leaflet-control-zoom,.leaflet-control-layers,.leaflet-control-attribution')].map(x=>x.getBoundingClientRect());
      const referenceOnly=D.mode==='gpx-only-reference';
      const expectedNoteText=(D.note||'')+' 停车后再操作地图。'+(referenceOnly?'GPX-only参考预览，不请求在线底图；缺少详细底图和道路服务，不是导航地图。':D.tileUrl===null?'本地道路研究预览，不请求在线底图；不是完整离线导航地图。':'高德可能重新算路；详细底图和高德链接需要联网。');
      const sourceSegments=D.originalGpx?.segments;
      const originalReferencePreserved=Array.isArray(sourceSegments)
        ? sourceSegments.length===(D.referenceRoutes||[]).length&&sourceSegments.every((points,index)=>JSON.stringify(points)===JSON.stringify(D.referenceRoutes[index]?.points))
        : !D.originalGpx||(D.referenceRoutes||[]).some(p=>JSON.stringify(p.points)===JSON.stringify(D.originalGpx.points));
      return {
        mode:D.mode??null,status:D.status,topology:D.topology,direction:D.direction,returnLegend:document.getElementById('returnLegend')?.textContent,parts:D.routeParts.length,points:coordinates.length,
        tileUrlPresent:Object.hasOwn(D,'tileUrl'),tileUrl:D.tileUrl??null,tileLayerCount:Object.values(map._layers).filter(layer=>layer instanceof L.TileLayer).length,
        cueCount:Array.isArray(D.cues)?D.cues.length:null,keyCueCount:Array.isArray(D.cues)?D.cues.filter(x=>x.kind==='key').length:null,
        supplyCount:Array.isArray(D.supplies)?D.supplies.length:null,optionalRouteCount:Array.isArray(D.optionalRoutes)?D.optionalRoutes.length:null,
        turnCandidateCount:Array.isArray(D.turnCandidates)?D.turnCandidates.length:null,researchMarkerCount:Array.isArray(D.researchMarkers)?D.researchMarkers.length:null,
        navigationRoutePartsPresent:Object.hasOwn(D,'navigationRouteParts'),actualStartPresent:Object.hasOwn(D,'actualStart'),actualEndPresent:Object.hasOwn(D,'actualEnd'),tileAttributionPresent:Object.hasOwn(D,'tileAttribution'),
        pendingChecksHasUndefined:document.getElementById('checks').textContent.includes('undefined'),
        coveredPoints:coordinates.filter(p=>p.x>=r.left&&p.x<=r.right&&p.y>=r.top&&p.y<=r.bottom).length,
        outOfViewport:coordinates.filter(p=>p.x<0||p.y<0||p.x>innerWidth||p.y>innerHeight).length,
        referencePoints:references.length,referenceLines:referenceLines.length,
        hiddenReferencePoints:references.filter(p=>p.x>=r.left&&p.x<=r.right&&p.y>=r.top&&p.y<=r.bottom||p.x<0||p.y<0||p.x>innerWidth||p.y>innerHeight).length,
        pointsUnderControls:[...coordinates,...references].filter(p=>controls.some(c=>p.x>=c.left&&p.x<=c.right&&p.y>=c.top&&p.y<=c.bottom)).length,
        buttonVisible:b.top>=r.top&&b.bottom<=innerHeight&&b.bottom<=r.bottom,
        overflow:document.documentElement.scrollWidth>innerWidth,
        navHref:document.getElementById('nextAmap').getAttribute('href'),
        segmentLinks:document.querySelectorAll('#segments a').length,
        segmentHrefs:[...document.querySelectorAll('#segments a')].map(a=>a.getAttribute('href')),
        expectedEndpoints:segments.map(s=>s.end?gcj(...s.end):null),
        navEndpointMarkerCount:document.querySelectorAll('.nav-endpoint-pin').length,
        navEndpointMarkerLabels:[...document.querySelectorAll('.nav-endpoint-pin')].map(x=>Number(x.textContent)),
        navEndpointActiveCount:document.querySelectorAll('.nav-endpoint-pin.active').length,
        navEndpointCandidateCount:document.querySelectorAll('.nav-endpoint-pin.candidate').length,
        navEndpointKinds:navEndpointMarkers.map(m=>({marker:m instanceof L.Marker,circle:m instanceof L.CircleMarker})),
        navEndpointLegendHidden:document.getElementById('navEndpointLegend').hidden,
        routeEngineGapExpected:Array.isArray(D.routeEngineGaps)?D.routeEngineGaps.length:0,
        routeEngineGapNames:(D.routeEngineGaps||[]).map(x=>x.name),
        routeEngineGapListCount:document.querySelectorAll('#routeGaps li').length,
        routeEngineGapLineCount:window.routeEngineGapLayers?.lines?.length??-1,
        routeEngineGapMarkerCount:window.routeEngineGapLayers?.markers?.length??-1,
        routeEngineGapVisibleLineCount:(window.routeEngineGapLayers?.lines||[]).filter(x=>map.hasLayer(x)).length,
        routeEngineGapVisibleMarkerCount:(window.routeEngineGapLayers?.markers||[]).filter(x=>map.hasLayer(x)).length,
        gapSectionHidden:document.getElementById('gapSection').hidden,
        gapLegendHidden:document.getElementById('gapLegend').hidden,
        segmentTitle:document.getElementById('segmentTitle').textContent,nextLabel:document.getElementById('next').textContent,
        nextStatHidden:document.getElementById('nextStat').hidden,focusHidden:document.getElementById('focus').hidden,
        stateText:document.getElementById('state').textContent,stateVisible:state.top>=r.top&&state.bottom<=r.bottom&&state.bottom<=innerHeight,
        offrouteBasis:document.getElementById('offroute').parentElement.querySelector('small').textContent,
        hasAmapEvidence:D.routeParts.some(p=>p.distanceEvidence?.type?.startsWith('amap')),
        mainLegend:document.getElementById('mainLegend').textContent,
        compositionText:document.getElementById('composition').textContent,
        noteText:document.getElementById('note').textContent,
        expectedNoteText,
        noteMatchesData:document.getElementById('note').textContent===expectedNoteText,
        noteHasInjectedMarkup:!!document.getElementById('note').querySelector('script,iframe'),
        originalGpxPoints:D.originalGpx?.points?.length||sourceSegments?.reduce((sum,segment)=>sum+segment.length,0)||0,
        originalGpxSegments:sourceSegments?.length??(D.originalGpx?.points?.length?1:0),
        originalReferencePreserved,
        localRoadCount:(D.localRoads||[]).length,researchMarkerName:D.researchMarkers?.[0]?.name,total:document.getElementById('total').textContent,
        routeParts:D.routeParts.map(p=>({type:p.type,pointCount:p.points.length,verified:p.verified}))
      };
    });
    assert.equal(info.overflow,false,'Horizontal overflow');
    assert.equal(info.buttonVisible,true,'Primary action hidden');
    assert.equal(info.coveredPoints,0,'Route hidden below panel');
    assert.equal(info.outOfViewport,0,'Route outside fitted viewport');
    assert.equal(info.hiddenReferencePoints,0,'Fixed reference hidden or outside fitted viewport');
    assert.equal(info.pointsUnderControls,0,'Route or reference hidden behind map controls');
    if(info.topology==='open'){assert.equal(info.returnLegend,'终点接驳','Open independent endpoint is not a return to start');assert.equal(info.compositionText.includes('返程'),false,'Open exit connector incorrectly called return');}
    if(info.referencePoints)assert.ok(info.referenceLines>0,'Fixed reference not rendered');
    assert.equal(info.originalReferencePreserved,true,'Complete original GPX has no independent matching reference layer');
    assert.equal(info.noteMatchesData,true,'Planning/safety note was not rendered in the map');
    assert.equal(info.noteHasInjectedMarkup,false,'Planning note must be plain text');
    const expectedMarkerCount=info.expectedEndpoints.filter(Boolean).length;
    assert.equal(info.navEndpointMarkerCount,expectedMarkerCount,'Navigation endpoint marker count differs from segment endpoints');
    assert.deepEqual(info.navEndpointMarkerLabels,Array.from({length:expectedMarkerCount},(_,i)=>i+1),'Navigation endpoint marker numbers differ from the segment list');
    assert.ok(info.navEndpointKinds.every(x=>x.marker&&!x.circle),'Navigation endpoints must use distinct numbered markers, not cue/supply circles');
    assert.equal(info.navEndpointActiveCount,expectedMarkerCount?1:0,'Exactly one navigation endpoint should be highlighted');
    assert.equal(info.routeEngineGapListCount,info.routeEngineGapExpected,'AMap graph-gap list count differs from route data');
    assert.equal(info.routeEngineGapLineCount,info.routeEngineGapExpected,'AMap graph-gap line count differs from route data');
    assert.equal(info.routeEngineGapMarkerCount,info.routeEngineGapExpected,'AMap graph-gap marker count differs from route data');
    assert.equal(info.routeEngineGapVisibleLineCount,info.routeEngineGapExpected,'AMap graph-gap lines are not active map layers');
    assert.equal(info.routeEngineGapVisibleMarkerCount,info.routeEngineGapExpected,'AMap graph-gap markers are not active map layers');
    assert.equal(info.gapSectionHidden,!info.routeEngineGapExpected,'AMap graph-gap detail visibility is wrong');
    assert.equal(info.gapLegendHidden,!info.routeEngineGapExpected,'AMap graph-gap legend visibility is wrong');
    if(info.routeEngineGapExpected)for(const name of info.routeEngineGapNames.slice(0,2))assert.ok(info.stateText.includes(name),'AMap graph-gap name absent from first-screen state');
    assert.equal(info.navEndpointLegendHidden,!expectedMarkerCount,'Navigation endpoint legend visibility is wrong');
    if(info.status==='complete')assert.equal(info.navEndpointCandidateCount,0,'Complete navigation endpoints use candidate styling');
    else assert.equal(info.navEndpointCandidateCount,expectedMarkerCount,'Draft endpoints must use candidate styling');
    assert.equal(/(?:null|undefined|NaN)\s*km/.test(info.compositionText),false,'Unknown distance displayed as a numeric mileage');
    if(!info.hasAmapEvidence)assert.equal(info.mainLegend.includes('高德'),false,'Non-AMap research data mislabeled as AMap navigation');
    if(info.status==='draft'){
      assert.equal(info.navHref,null,'Draft navigation must remain disabled');
      assert.equal(info.segmentLinks,0,'Draft segment links must remain disabled');
      assert.ok(info.mode==='gpx-only-reference'?info.segmentTitle.includes('无导航分段'):info.segmentTitle.includes('待核实'),'Draft cannot claim confirmed switch count');
      assert.equal(info.nextLabel,info.mode==='gpx-only-reference'?'未生成导航终点':'导航终点待核实','Draft cannot claim an approved next endpoint');
      assert.equal(info.offrouteBasis,info.mode==='gpx-only-reference'?'未生成道路候选':info.hasAmapEvidence?'距高德候选（未验收）':'距候选路线（未验收）','Draft projection has wrong distance source');
      assert.equal(info.stateVisible,true,'Draft reason hidden below initial panel');
      assert.ok(/待核实|未核实|待核对|尚未核对|不一致|缺失/.test(info.stateText),'Specific draft reason absent from first-screen state');
      if(info.mode==='gpx-only-reference'){
        assert.equal(info.parts,0,'GPX-only preview invented a road route part');
        assert.equal(info.points,0,'GPX-only preview invented road geometry');
        assert.equal(info.topology,null,'GPX-only preview inferred topology');
        assert.equal(info.direction,null,'GPX-only preview inferred direction');
        assert.equal(info.localRoadCount,0,'GPX-only preview contains local road data');
        assert.equal(info.tileUrlPresent,true,'GPX-only preview omits the explicit offline tile setting');
        assert.equal(info.tileUrl,null,'GPX-only preview enables an online tile URL');
        assert.equal(info.tileLayerCount,0,'GPX-only preview created a tile layer');
        for(const field of ['cueCount','keyCueCount','supplyCount','optionalRouteCount','turnCandidateCount','researchMarkerCount'])assert.equal(info[field],0,'GPX-only preview contains forbidden layer or prompt data: '+field);
        for(const field of ['navigationRoutePartsPresent','actualStartPresent','actualEndPresent','tileAttributionPresent','pendingChecksHasUndefined'])assert.equal(info[field],false,'GPX-only preview contains forbidden or invalid UI data: '+field);
        assert.equal(info.total,'总里程待核实','GPX-only preview exposed a total mileage');
        assert.ok(info.originalGpxSegments>0,'GPX-only preview lost source segments');
        assert.equal(info.nextStatHidden,true,'GPX-only preview shows a next-navigation-endpoint card');
        assert.equal(info.focusHidden,true,'GPX-only preview shows an unusable current-segment control');
      }
    }else{
      assert.equal(info.status,'complete','Unknown delivery state');
      assert.ok(info.expectedEndpoints.length>0,'Complete map has no navigation segments');
      assert.equal(info.segmentLinks,info.expectedEndpoints.length,'Complete map missing segment navigation links');
      const checkLink=(href,p)=>{
        assert.ok(href&&p,'Complete segment has no navigation link or endpoint');
        const u=new URL(href);
        assert.equal(u.origin,'https://uri.amap.com','Wrong navigation service');
        assert.equal(u.pathname,'/navigation','Wrong navigation entry');
        assert.equal(u.searchParams.get('mode'),'ride','Link is not cycling');
        assert.equal(u.searchParams.get('callnative'),'1','Native app request missing');
        assert.equal(u.searchParams.get('to'),p[1].toFixed(6)+','+p[0].toFixed(6),'Link destination differs from displayed segment');
      };
      info.segmentHrefs.forEach((href,i)=>checkLink(href,info.expectedEndpoints[i]));
      checkLink(info.navHref,info.expectedEndpoints[0]);
      const selected=await page.evaluate(()=>{
        const buttons=[...document.querySelectorAll('#segments button')];
        const index=buttons.length-1;buttons[index].click();
        const href=document.getElementById('nextAmap').getAttribute('href');
        const activeLabel=Number(document.querySelector('.nav-endpoint-pin.active')?.textContent);
        buttons[0].click();fitRoute();return {href,index,activeLabel};
      });
      checkLink(selected.href,info.expectedEndpoints[selected.index]);
      assert.equal(selected.activeLabel,selected.index+1,'Segment-list selection did not highlight the matching numbered endpoint');
      const markerSelected=await page.evaluate(()=>{
        const index=navEndpointMarkers.length-1;
        navEndpointMarkers[index].fire('click');
        const result={index,chosen,href:document.getElementById('nextAmap').getAttribute('href'),activeLabel:Number(document.querySelector('.nav-endpoint-pin.active')?.textContent)};
        selectSegment(0);map.closePopup();navEndpointMarkers.forEach(m=>m.closeTooltip());fitRoute();return result;
      });
      assert.equal(markerSelected.chosen,markerSelected.index,'Numbered endpoint click did not select its segment');
      assert.equal(markerSelected.activeLabel,markerSelected.index+1,'Numbered endpoint click did not preserve its highlight');
      checkLink(markerSelected.href,info.expectedEndpoints[markerSelected.index]);
      info.selectedNavigationLinkVerified=true;
      const gpsCases=await page.evaluate(()=>{
        const cases=[],skipped=[];
        const expectedEnds=[];let expectedCovered=0;
        for(const segment of segments){
          const p=segment.points||[];
          expectedCovered+=p.slice(1).reduce((sum,point,i)=>sum+hav(p[i],point),0);
          expectedEnds.push(expectedCovered);
        }
        for(let index=0;index<segments.length;index++){
          const points=segments[index].points||[];let sample;
          for(let j=1;j<points.length;j++){
            const p=[(points[j-1][0]+points[j][0])/2,(points[j-1][1]+points[j][1])/2],hit=projectToRoute(p);
            const ambiguous=hit.candidates.some(x=>x.distance<=hit.distance+35&&Math.abs(x.along-hit.along)>500);
            if(!ambiguous&&hit.distance<5&&hit.along>(index?expectedEnds[index-1]:0)+100&&hit.along<expectedEnds[index]-100){sample=p;break;}
          }
          if(!sample){skipped.push({segment:index+1,reason:'No unique interior GPS sample; cannot certify automatic selection on overlap'});continue;}
          chosen=0;guidanceUncertain=false;render();
          Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:ok=>ok({coords:{latitude:sample[0],longitude:sample[1],accuracy:5}})}});
          document.getElementById('locate').click();
          cases.push({expected:index,selected:chosen,uncertain:guidanceUncertain,href:document.getElementById('nextAmap').getAttribute('href'),point:sample});
        }
        chosen=0;guidanceUncertain=false;render();fitRoute();return {cases,skipped};
      });
      for(const c of gpsCases.cases){
        assert.equal(c.uncertain,false,'Unique GPS sample incorrectly treated as uncertain');
        assert.equal(c.selected,c.expected,'GPS selected the wrong loop navigation occurrence');
        checkLink(c.href,info.expectedEndpoints[c.expected]);
      }
      info.gpsSegmentSelection=gpsCases;
    }
    const focus=await page.evaluate(()=>{
      const button=document.getElementById('focus');
      if(!button)return {available:false};
      if(!segments.length)return {available:true,skipped:true};
      const original=chosen;chosen=Math.min(1,segments.length-1);render();
      const before=map.getBounds().toBBoxString();button.click();
      const p=segments[chosen].points||parts[chosen]?.points||[],r=document.querySelector('.panel').getBoundingClientRect();
      const pixels=p.map(q=>map.latLngToContainerPoint(gcj(...q)));
      const result={available:true,changed:map.getBounds().toBBoxString()!==before,points:p.length,
        hidden:pixels.filter(q=>q.x<0||q.y<0||q.x>innerWidth||q.y>innerHeight||q.x>=r.left&&q.x<=r.right&&q.y>=r.top&&q.y<=r.bottom).length};
      chosen=original;render();fitRoute();return result;
    });
    assert.equal(focus.available,true,'Current segment focus action missing');
    if(!focus.skipped){assert.equal(focus.hidden,0,'Selected segment hidden in focused view');if(info.parts>1)assert.equal(focus.changed,true,'Focus did not change the map view');}
    const projection=await page.evaluate(()=>{
      const original=parts.slice();
      try{
        parts.splice(0,parts.length,
          {points:[[0,0],[0,.01]],distanceKm:1},
          {points:[[0,.02],[0,.03]],distanceKm:4});
        const gap=projectToRoute([0,.015]);
        const progress=projectToRoute([0,.025]);
        return {gapDistance:gap.distance,remainingKm:(progress.navigationTotal-progress.navigationAlong)/1000};
      }finally{parts.splice(0,parts.length,...original)}
    });
    assert.ok(projection.gapDistance>500,'Invisible straight-line stitch treated as route');
    assert.ok(Math.abs(projection.remainingKm-2)<.001,'Remaining distance not calibrated per leg');
    const zoom=await page.evaluate(()=>{
      const before=map.getZoom();map.setZoom(before+2,{animate:false});
      const after=map.getZoom();fitRoute();return {before,after};
    });
    assert.equal(zoom.after,zoom.before+2,'Zoom control ineffective');
    const zoomLimit=await page.evaluate(()=>{
      if(D.tileUrl===null||D.tileUrl)return {defaultProvider:false};
      map.setZoom(19,{animate:false});
      const result={defaultProvider:true,actual:map.getZoom(),maximum:map.getMaxZoom()};
      fitRoute();return result;
    });
    if(zoomLimit.defaultProvider){assert.equal(zoomLimit.actual,18,'Default provider permits blank zoom19');assert.equal(zoomLimit.maximum,18);}
    const denied=await page.evaluate(()=>{
      Object.defineProperty(navigator,'geolocation',{configurable:true,value:{
        getCurrentPosition:(ok,fail)=>fail({code:1})}});
      document.getElementById('locate').click();
      return document.getElementById('offroute').textContent;
    });
    assert.equal(denied,'定位未授权');
    const failedLocation=await page.evaluate(()=>{
      const point=parts.find(p=>p.points?.length)?.points[0];
      if(point){
        Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:ok=>ok({coords:{latitude:point[0],longitude:point[1],accuracy:5}})}});
        $('locate').click();
      }
      Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:(ok,fail)=>fail({code:1})}});
      $('locate').click();
      const result={accuracy:$('accuracy').textContent,reference:$('referenceGap').textContent,remaining:$('remaining').textContent,markerVisible:!!marker&&map.hasLayer(marker),href:$('nextAmap').getAttribute('href'),cue:$('nextCue').textContent,buttonText:$('nextAmap').textContent};
      if(complete){document.querySelector('#segments button')?.click();result.manualRecovery=$('nextAmap').getAttribute('href')!==null;}
      fitRoute();return result;
    });
    assert.equal(failedLocation.accuracy,'');assert.equal(failedLocation.markerVisible,false);assert.equal(failedLocation.href,null);
    assert.equal(failedLocation.remaining,info.status==='complete'?'暂不估算':'待验收');assert.ok(!/\d+\s*m/.test(failedLocation.reference));
    if(info.status==='complete')assert.equal(failedLocation.manualRecovery,true,'Static manual navigation unavailable after GPS loss');
    if(info.mode==='gpx-only-reference'){assert.equal(failedLocation.cue,'定位不可用；GPX 仅作人工对照');assert.equal(failedLocation.buttonText,'仅供 GPX 对照 · 暂不可导航');}
    if(info.status==='draft'){
      const located=await page.evaluate(()=>{
        const point=D.routeParts.find(p=>p.points?.length)?.points[0];if(!point)return null;
        Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:ok=>ok({coords:{latitude:point[0],longitude:point[1],accuracy:5}})}});
        document.getElementById('locate').click();
        const result={basis:document.getElementById('offrouteBasis').textContent,cue:document.getElementById('nextCue').textContent,
          remaining:document.getElementById('remaining').textContent,href:document.getElementById('nextAmap').getAttribute('href')};
        fitRoute();return result;
      });
      if(located){assert.equal(located.basis,info.hasAmapEvidence?'距高德候选（未验收）':'距候选路线（未验收）');assert.ok(located.cue.includes('不提供下一点指引'));assert.equal(located.remaining,'待验收');assert.equal(located.href,null);}
    }
    const popup=await page.evaluate(()=>{
      const sample=D.researchMarkers?.[0];
      if(!sample)return null;
      const marker=Object.values(map._layers).find(l=>l.getPopup?.()?.getContent()?.textContent===sample.name);
      if(!marker)return null;
      marker.openPopup();const text=document.querySelector('.leaflet-popup-content')?.textContent;
      map.stop();map.closePopup();fitRoute();return text;
    });
    if(info.status==='draft'&&info.localRoadCount>0)assert.equal(popup,info.researchMarkerName,'Research marker popup unavailable or inconsistent with current input');
    assert.deepEqual(errors,[],'Runtime page errors');
    await page.waitForTimeout(300);
    const screenshotVisibility=await page.evaluate(()=>{
      const r=document.querySelector('.panel').getBoundingClientRect();
      const points=[...(D.navigationRouteParts||D.routeParts||[]),...(D.referenceRoutes||[])].flatMap(p=>p.points||[]).map(p=>map.latLngToContainerPoint(gcj(...p)));
      const controls=[...document.querySelectorAll('.leaflet-control-zoom,.leaflet-control-layers,.leaflet-control-attribution')].map(x=>x.getBoundingClientRect());
      return {pointCount:points.length,hidden:points.filter(p=>p.x<0||p.y<0||p.x>innerWidth||p.y>innerHeight||p.x>=r.left&&p.x<=r.right&&p.y>=r.top&&p.y<=r.bottom||controls.some(c=>p.x>=c.left&&p.x<=c.right&&p.y>=c.top&&p.y<=c.bottom)).length};
    });
    assert.equal(screenshotVisibility.hidden,0,'Screenshot route fit was changed by QA interactions');
    await page.mouse.move(Math.floor(width/2),2);
    await page.evaluate(()=>navEndpointMarkers.forEach(m=>m.closeTooltip()));
    await page.screenshot({path:path.join(outDir,name+'.png')});
    assert.equal(createHash('sha256').update(await fs.readFile(pageFile)).digest('hex'),mapSha256,'Map changed during browser QA');
    results.push({name,mapSha256,...info,currentSegmentFocus:focus,projection,zoom,zoomLimit,permissionDenied:denied,failedLocation,markerPopup:popup,screenshotVisibility,pageErrors:errors});
    await context.close();
  }
  await fs.writeFile(path.join(outDir,'browser-results.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({passed:true,viewports:results.map(r=>({name:r.name,points:r.points,coveredPoints:r.coveredPoints,status:r.status}))}));
}catch(e){
  await fs.writeFile(path.join(outDir,'qa-failure.json'),JSON.stringify({status:'failed',stage:failureStage,mapSha256,startedAt:qaStartedAt,failedAt:new Date().toISOString(),message:e.message},null,2),{flag:'wx'});
  throw e;
}finally{if(browser)await browser.close()}
