import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {publicAssets, writePortfolio} from './portfolio.mjs';

const source = fs.mkdtempSync(path.join(os.tmpdir(), 'courtedge-'));
try {
  const research = path.join(source,'dist');
  const portfolio = path.join(source,'portfolio');
  const target = path.join(source,'public');
  fs.mkdirSync(research);
  fs.mkdirSync(portfolio);
  for (const name of ['raw.csv','data.zip','kaggle.ipynb','current.json']) {
    fs.writeFileSync(path.join(research,name),'PROVIDER-ROWS');
    fs.writeFileSync(path.join(portfolio,name),'PROVIDER-ROWS');
  }
  for (const [name, content] of Object.entries(publicAssets())) fs.writeFileSync(path.join(portfolio,name),content);
  const written = writePortfolio(fs,target,portfolio);
  assert.deepEqual(written,['index.html','style.css']);
  assert.deepEqual(fs.readdirSync(target).sort(),written);
  assert.match(fs.readFileSync(path.join(target,'index.html'),'utf8'),/tennismylife\.org\/tennis-match-database/);
  assert.doesNotMatch(Object.values(publicAssets(fs,portfolio)).join(' '),/PROVIDER-ROWS|\/api\/season|download=|\.csv/i);
  fs.writeFileSync(path.join(target,'stale.zip'),'PROVIDER-ROWS');
  assert.throws(() => writePortfolio(fs,target,portfolio), /unexpected files/);
  console.log('PASS: public build allows only HTML/CSS, ignores injected raw/archive/notebook/API assets, and rejects a dirty output directory.');
} finally {
  fs.rmSync(source,{recursive:true,force:true});
}
