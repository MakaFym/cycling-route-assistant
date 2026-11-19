import test from 'node:test';
import assert from 'node:assert/strict';
import {isEvidenceDate,evidenceDay} from './evidence-dates.mjs';
import {reviewStatus} from './review-status.mjs';
test('calendar validation rejects Date.parse rollovers and ambiguous timestamps while preserving real zoned dates',()=>{
 for(const value of ['2024-02-29','2000-02-29','2026-02-28','2026-10-13T17:05:00.123Z','2026-10-13T20:30:00+08:00'])assert.equal(isEvidenceDate(value),true,value);
 for(const value of ['2026-02-30','2026-02-29','1900-02-29','2026-04-31','2026-13-01','2026-10-13T24:00:00Z','2026-10-13T20:30:00+24:00','2026-10-13T20:30:00',null,''])assert.equal(isEvidenceDate(value),false,String(value));
 assert.equal(evidenceDay('2026-10-13T17:05:00Z'),'2026-10-14');assert.equal(evidenceDay('2026-10-13'),'2026-10-13');
 assert.throws(()=>evidenceDay('2026-02-30'),/Invalid evidence date/);
});
test('all-true review flags with a nonexistent calendar date cannot certify roads',()=>{
 const r={routeAndRoadsChecked:true,navDeletionChecked:true,accessChecked:true,checkedAt:'2026-02-30',evidence:'Synthetic only; not actual road or field proof'};
 assert.equal(reviewStatus(r).complete,false);assert.equal(reviewStatus(r).evidenceValid,false);
 r.checkedAt='2026-02-28';assert.equal(reviewStatus(r).complete,true);
});
