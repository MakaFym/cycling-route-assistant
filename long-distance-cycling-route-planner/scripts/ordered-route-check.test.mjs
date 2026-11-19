import test from 'node:test';
import assert from 'node:assert/strict';
import {orderedRouteCheck} from './ordered-route-check.mjs';
test('zero-length, invalid and impractically coarse route comparisons cannot silently pass',()=>{
  assert.throws(()=>orderedRouteCheck([[0,0],[0,0]],[[0,0],[0,.01]]),/zero-length/);
  assert.throws(()=>orderedRouteCheck([[0,0],[999,0]],[[0,0],[0,.01]]),/valid/);
  assert.throws(()=>orderedRouteCheck([[0,0],[0,4]],[[0,0],[0,4]]),/smaller route spans/);
});
test('ordered comparison is independent of input point density',()=>{
  const sparse=[[0,0],[0,.02]],dense=Array.from({length:101},(_,i)=>[0,i*.0002]);
  const result=orderedRouteCheck(sparse,dense);
  assert.equal(result.orderCompatible,true);assert.ok(result.orderedDistanceMetres<1);
});
