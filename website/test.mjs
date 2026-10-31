import assert from 'node:assert/strict';
import fs from 'node:fs';
import {predict,validate} from './dist/model.js';
const read=name=>JSON.parse(fs.readFileSync(new URL('./dist/data/'+name+'.json',import.meta.url)));
const models=read('models'),fixtures=read('fixtures'),matches=read('matches');
assert.equal(matches.length,5054);assert.equal(matches.filter(r=>r.valid_score).length,4874);assert.equal(matches.filter(r=>r.analysis_eligible).length,1578);
for(const f of fixtures){
 const s={tour:f.tour,surface:'Hard',bestOf:3,round:'QF'};
 for(const k of ['a','b'])s[k]={name:f['name_'+k],rank:f['rank_'+k],age:f['age_'+k],qualifier:!!f['qualifier_'+k],minutes:Math.round(f['prior_hours_'+k]*60),matches:f['prior_matches_'+k]};
 assert.equal(validate(s),'');
 const p=predict(s,models),swap=predict({...s,a:s.b,b:s.a},models);
 for(const key of ['strength','strength_workload']){assert.ok(Math.abs(p[key]-f['p_a_'+key])<1e-10);assert.ok(Math.abs(p[key]+swap[key]-1)<1e-12);}
 const extra=predict({...s,a:{...s.a,minutes:s.a.minutes+60}},models);
 assert.ok(extra.strength_workload<p.strength_workload);assert.equal(extra.strength,p.strength);
 assert.match(validate({...s,a:{...s.a,minutes:NaN}}),/minutes/);
 assert.match(validate({...s,a:{...s.a,matches:0}}),/matches/);
 assert.match(validate({...s,b:{...s.b,name:s.a.name}}),/different/);
}
const html=fs.readFileSync(new URL('./dist/index.html',import.meta.url),'utf8');assert.ok(html.includes('lang="en"'));
for(const f of read('downloads'))assert.ok(fs.existsSync(new URL('./dist/downloads/'+f.name,import.meta.url)));
console.log('PASS: 5,054 records; quality totals; four fixture predictions match Python; swap symmetry; workload sensitivity; validation boundaries; all download links.');
