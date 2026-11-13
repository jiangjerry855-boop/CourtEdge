import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseCSV, normalize, score, analyze, SOURCES} from './live-data.js';
import {localBucket} from './local-bucket.mjs';
import worker from './dist/server/index.js';

const current = JSON.parse(fs.readFileSync('dist/data/current.json'));
const eda = analyze(current.matches);
assert.equal(eda.total, current.audit.records);
assert.equal(eda.completed, current.audit.completed);
assert.equal(eda.tours.ATP.completed + eda.tours.WTA.completed, eda.completed);
assert.equal(eda.players.reduce((n, p) => n + p.matches, 0), eda.completed * 2);
assert.equal(score('6-4 2-1 RET', 3), null);
assert.equal(score('W/O', 3), null);
assert.deepEqual(score('7-6(4) 6-3', 3), {sets: 2, games: 22});
assert.throws(() => parseCSV('<html>blocked</html>'));
assert.throws(() => normalize(Object.fromEntries(SOURCES.map(s => [s, 'broken']))));

// Exercise the same raw CSV path used by the packaged export and runtime refresh.
const files = Object.fromEntries(SOURCES.map(name => [name, fs.readFileSync('snapshots/' + name, 'utf8')]));
const baseline = normalize(files);
assert.deepEqual(baseline.audit, current.audit);
assert.equal(baseline.audit.raw, baseline.audit.records + baseline.audit.duplicates
  + baseline.audit.invalidDate + baseline.audit.excludedYear);
assert.deepEqual(JSON.parse(fs.readFileSync('dist/downloads/current_matches_2026.audit.json')).audit, current.audit);
assert.equal(fs.readFileSync('live-data.js', 'utf8'), fs.readFileSync('dist/live-data.js', 'utf8'));

const mock = {tourney_id: 'test-cleaning', tourney_date: '20260228', round: 'QF',
  winner_id: ' 001 ', loser_id: 'A002', winner_entry: 'Wc', winner_ht: '20080331',
  winner_seed: '6.0', loser_seed: 'Q', loser_entry: '', minutes: '0', best_of: '3', score: ' 6-3 6-2 '};
const append = (name, row) => {
  const headers = Object.keys(parseCSV(files[name])[0]);
  const cells = headers.map(key => '"' + String(row[key] ?? '').replaceAll('"', '""') + '"');
  files[name] = files[name].trimEnd() + '\n' + cells.join(',') + '\n';
};
append(SOURCES[0], mock);
append(SOURCES[0], {...mock, tourney_date: '20260230'});
append(SOURCES[0], {...mock, tourney_date: '20251231'});
append('ongoing_tourneys.csv', {...mock, minutes: '95'});
const cleaned = normalize(files);
assert.equal(cleaned.audit.records, baseline.audit.records + 1);
assert.equal(cleaned.audit.invalidDate, baseline.audit.invalidDate + 1);
assert.equal(cleaned.audit.excludedYear, baseline.audit.excludedYear + 1);
assert.equal(cleaned.audit.duplicates, baseline.audit.duplicates + 1);
const row = cleaned.matches.find(match => match.tourney_id === mock.tourney_id);
assert.deepEqual([row.winner_id, row.winner_seed, row.winner_entry, row.winner_ht, row.loser_seed,
  row.loser_entry, row.minutes, row.score, row.games], ['001', 6, 'WC', null, null, 'Q', 95, '6-3 6-2', 17]);
assert.equal(cleaned.audit.changes.invalidMinutes, baseline.audit.changes.invalidMinutes + 1);
assert.equal(score('6-3 6-2 0-6', 3), null);
assert.equal(score('6-2 2-6 [10-8]', 3), null);

const request = new Request('https://test/api/season');
const read = async bucket => (await worker.fetch(request, {BUCKET: bucket})).json();
const bucket = localBucket();
Object.defineProperty(globalThis, 'caches', {configurable: true, get() {throw Error('Default cache access denied');}});
const originalFetch = globalThis.fetch;
const now = Date.now;
let clock = now();
Date.now = () => clock;
const expire = () => { clock += 901000; };
let sourceRequests = 0;
const source = async url => {
  sourceRequests++;
  return new Response(fs.readFileSync('snapshots/' + new URL(url).pathname.split('/').at(-1)));
};
globalThis.fetch = async () => new Response('unavailable', {status: 503});
try {
  const missing = await read(undefined);
  assert.equal(missing.error_stage, 'storage_read');
  assert.equal(missing.last_origin_success_at, null);
  const failed = await read(bucket);
  assert.equal(failed.status, 'stale');
  assert.match(failed.error, /503/);
  assert.equal(failed.last_success_at, current.last_success_at);
  assert.equal(failed.audit.records, eda.total);
  assert.equal(failed.snapshot_id.length, 64);
  expire();
  globalThis.fetch = source;
  const ok = await read(bucket);
  assert.equal(ok.status, 'ok');
  assert.equal(ok.sources.length, 4);
  assert.equal(ok.last_origin_success_at, ok.last_success_at);
  assert.equal(ok.data_origin, 'provider');
  const checks = sourceRequests;
  clock = Date.parse(ok.last_attempt_at) + 1000;
  const cached = await read(bucket);
  assert.equal(sourceRequests, checks);
  assert.equal(cached.last_attempt_at, ok.last_attempt_at);
  const conditional = async id => (await worker.fetch(
    new Request(request.url + '?known=' + id), {BUCKET: bucket})).json();
  const same = await conditional(ok.snapshot_id);
  assert.equal(same.unchanged, true);
  assert.equal(same.matches, undefined);
  assert.deepEqual(same.sources, ok.sources);
  assert.equal((await conditional('older-id')).matches.length, ok.audit.records);
  expire();
  const denied = await read({get: bucket.get, put() {throw Error('write denied');}});
  assert.equal(denied.error_stage, 'storage_write');
  assert.equal(denied.snapshot_id, ok.snapshot_id);
  const race = await read({get: bucket.get, put: async () => null});
  assert.equal(race.last_success_at, ok.last_success_at);
  globalThis.fetch = async () => new Response('down', {status: 502});
  const stale = await read(bucket);
  assert.equal(stale.error_stage, 'upstream');
  assert.equal(stale.last_origin_success_at, ok.last_origin_success_at);
  assert.equal(stale.snapshot_id, ok.snapshot_id);
  assert.deepEqual(stale.sources, ok.sources);
  const home = await worker.fetch(new Request('https://test/'), {});
  assert.match(await home.text(), /EDA & updates/);
  const pdf = await worker.fetch(new Request('https://test/downloads/Tennis_Fatigue_2026_Report.pdf'), {});
  assert.equal((await pdf.arrayBuffer()).byteLength, fs.statSync('dist/downloads/Tennis_Fatigue_2026_Report.pdf').size);
} finally {
  globalThis.fetch = originalFetch;
  Date.now = now;
  delete globalThis.caches;
}
console.log('PASS: source validation, EDA totals, default cache forbidden, storage faults, provider fallback, TTL, concurrent write and static assets.');
