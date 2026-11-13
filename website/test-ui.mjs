import fs from 'node:fs';
import assert from 'node:assert/strict';
import {snapshotId} from './live-data.js';

const elements = new Map();
function element(key) {
  if (!elements.has(key)) elements.set(key, {innerHTML:'', textContent:'', value:'',
    classList:{add(){}, remove(){}, toggle(){}}, addEventListener(){}, setAttribute(){}, removeAttribute(){},
    querySelector:s => element(key + ' ' + s), querySelectorAll:() => []});
  return elements.get(key);
}
const statusLabels = [element('sidebar-state'), element('footer-state')];
globalThis.document = {querySelector:element, querySelectorAll:s => s === '[data-season-state]' ? statusLabels : [],
  createElement:() => ({click(){}, remove(){}}), body:{append(){}}, title:''};
globalThis.location = {hash:'#eda'};
const events = new Map();
globalThis.window = {addEventListener(name, fn){ events.set(name, fn); }, scrollTo(){}};
globalThis.setInterval = () => {};
let exported;
URL.createObjectURL = blob => { exported = blob; return 'blob:test'; };
const packaged = JSON.parse(fs.readFileSync('dist/data/current.json'));
const next = structuredClone(packaged);
for (let i = 0; i < 4; i++) next.matches.push({...next.matches.find(r => r.valid_score), tourney_id:'test-event-' + i});
next.audit.records += 4;
next.audit.completed += 4;
next.sources[0].sha256 = '1'.repeat(64);
next.snapshot_id = await snapshotId(next.sources);
next.status = 'ok';
next.data_origin = 'provider';
next.last_success_at = next.last_origin_success_at = new Date().toISOString();
let reply = () => Response.json(next);
const requests = [];
globalThis.fetch = async url => {
  requests.push(url);
  if (url.startsWith('/api/season?known=')) return reply();
  return new Response(fs.readFileSync('dist/' + url));
};
await import('./dist/app.js');
await new Promise(resolve => setImmediate(resolve));
assert.ok(element('#main').innerHTML.includes(next.audit.records.toLocaleString('en-US')));
assert.match(element('#main').innerHTML, /Correlations and fatigue proxies/);
assert.match(element('#data-status').innerHTML, /15 minutes/);
assert.equal(statusLabels[0].textContent, 'Provider snapshot verified');
reply = () => new Response('runtime error', {status:500});
await element('#refresh-data').onclick();
assert.ok(statusLabels.every(el => el.textContent.includes('Refresh failed')));
element('#export-eda').onclick();
const result = JSON.parse(await exported.text());
assert.equal(result.status, 'stale');
assert.equal(result.error_stage, 'browser_request');
assert.equal(result.eda.total, result.audit.records);
assert.equal(result.eda.completed, next.audit.completed);
assert.deepEqual(result.sources, next.sources);
assert.equal(result.snapshot_id, next.snapshot_id);
assert.ok(result.browser_checked_at);
assert.equal(result.last_origin_success_at, next.last_success_at);
console.log('PASS: refreshed EDA, four added results with unchanged max date, failed request, consistent status labels and exported provenance.');

assert.ok(!requests.some(url => ['data/matches.json','data/players.json','data/summary.json'].includes(url)));
reply = () => Response.json({...next, matches: undefined, unchanged: true});
await element('#refresh-data').onclick();
assert.equal(statusLabels[0].textContent, 'Provider snapshot verified');
assert.ok(requests.includes('/api/season?known=' + next.snapshot_id));
location.hash = '#overview';
events.get('hashchange')();
assert.match(element('#main').innerHTML, /Recent results/);
location.hash = '#players';
events.get('hashchange')();
element('#player-tour').onchange({target:{value:'WTA'}});
element('#player-min').onchange({target:{value:'25'}});
element('#export-players').onclick();
const playerCsv = (await exported.text()).split('\r\n');
const expected = result.eda.players.filter(p => p.tour === 'WTA' && p.matches >= 25)
  .sort((a,b) => b.wins-a.wins || b.matches-a.matches);
assert.equal(playerCsv.length - 1, expected.length);
assert.ok(playerCsv.every((line, i) => !i || line.includes('"' + expected[i-1].key + '"')));
element('#player-search').oninput({target:{value:'no-player-with-this-name'}});
assert.equal(element('#export-players').disabled, true);
console.log('PASS: lean startup, lightweight refresh, recent results and filtered player export.');
