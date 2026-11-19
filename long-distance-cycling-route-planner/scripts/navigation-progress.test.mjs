import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {metres} from './diagnose-osm-route.mjs';
const template=await fs.readFile(new URL('../assets/map-shell.html',import.meta.url),'utf8');
const match=template.match(/function navigationBoundaries\(items\)\{([\s\S]*?)\n\}/);
if(!match)throw Error('Navigation boundary implementation missing');
// Execute the shipped template implementation, not a separate reimplementation.
const boundaries=new Function('hav','return function navigationBoundaries(items){'+match[1]+'\n}')(metres);
test('repeated loop endpoints retain their later occurrence instead of projecting to the outbound join',()=>{
 const a=[0,0],b=[0,.01],c=[.01,.01],d=[.01,0];
 const items=[{points:[a,b]},{points:[b,c]},{points:[c,d,b]},{points:[b,a]}];
 const ends=boundaries(items);
 assert.ok(ends.every((x,i)=>i===0||x>ends[i-1]));
 assert.ok(ends[2]>ends[0]+2000);
 const beforeLastJoin=ends[2]-200,uniqueReturnProgress=ends[2]+200;
 assert.equal(ends.findIndex(x=>x>beforeLastJoin-50),2);
 assert.equal(ends.findIndex(x=>x>uniqueReturnProgress-50),3);
 assert.ok(Math.abs(ends[3]-items.reduce((sum,item)=>sum+item.points.slice(1).reduce((s,p,i)=>s+metres(item.points[i],p),0),0))<1e-6);
});
test('missing or zero-length navigation geometry is explicit, not guessed from endpoint coordinates',()=>{
 assert.equal(boundaries([{end:[0,.01]}])[0],Infinity);
 assert.equal(boundaries([{points:[[0,0],[0,0]]}])[0],Infinity);
});
