import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('./check-map-browser.mjs',import.meta.url));

async function workspace(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'check-map-browser-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  return dir;
}

function run(args,env={}){
  return spawnSync(process.execPath,[script,...args],{
    encoding:'utf8',
    env:{...process.env,...env}
  });
}

test('missing map writes structured failure evidence to a new QA directory',async t=>{
  const dir=await workspace(t),qa=path.join(dir,'qa'),missing=path.join(dir,'missing-map.html');
  const result=run([missing,qa],{PLAYWRIGHT_MODULE:'__missing_playwright_for_regression_test__'});
  assert.notEqual(result.status,0);
  const failure=JSON.parse(await fs.readFile(path.join(qa,'qa-failure.json'),'utf8'));
  assert.equal(failure.status,'failed');
  assert.equal(failure.stage,'map-input');
  assert.match(failure.failedAt,/^\d{4}-\d{2}-\d{2}T/);
  assert.match(failure.message,/map HTML/i);
  assert.match(failure.message,/verify|readable|exists/i);
});

test('missing optional Playwright module explains the runtime prerequisite',async t=>{
  const dir=await workspace(t),qa=path.join(dir,'qa'),map=path.join(dir,'map.html');
  await fs.writeFile(map,'<!doctype html><title>fixture</title>');
  const result=run([map,qa],{PLAYWRIGHT_MODULE:'__missing_playwright_for_regression_test__'});
  assert.notEqual(result.status,0);
  const failure=JSON.parse(await fs.readFile(path.join(qa,'qa-failure.json'),'utf8'));
  assert.equal(failure.status,'failed');
  assert.equal(failure.stage,'browser-dependency');
  assert.match(failure.message,/PLAYWRIGHT_MODULE/);
  assert.match(failure.message,/optional|test environment|runtime prerequisite/i);
});

test('nonempty prior QA directory is not modified on failure',async t=>{
  const dir=await workspace(t),qa=path.join(dir,'qa'),marker=path.join(qa,'prior-evidence.txt');
  await fs.mkdir(qa);
  await fs.writeFile(marker,'keep exactly');
  const before=await fs.readdir(qa);
  const result=run([path.join(dir,'missing-map.html'),qa],{PLAYWRIGHT_MODULE:'__missing_playwright_for_regression_test__'});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/new or empty|preserve prior evidence/i);
  assert.deepEqual(await fs.readdir(qa),before);
  assert.equal(await fs.readFile(marker,'utf8'),'keep exactly');
});
