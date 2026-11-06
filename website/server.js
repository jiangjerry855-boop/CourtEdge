import {SOURCES, ORIGIN, normalize, snapshotId} from './live-data.js';
import {assets} from './embedded-assets.js';

const TTL = 900;
const seasonKey = 'season/2026/v2.json';

async function asset(path) {
  const a = assets[path];
  if (!a) return new Response('Not found', {status: 404});
  const bytes = Uint8Array.from(atob(a.data), c => c.charCodeAt(0));
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')), {
    headers: {'Content-Type': a.type, 'Cache-Control': 'public, max-age=60', 'X-Content-Type-Options': 'nosniff'}
  });
}

async function fallback() {
  const data = await (await asset('/data/current.json')).json();
  return {...data, snapshot_id: data.snapshot_id || await snapshotId(data.sources), data_origin: 'packaged',
    last_origin_success_at: null, last_origin_attempt_at: null};
}

function stale(previous, stage, error, attempted) {
  return {...previous, status: 'stale', error_stage: stage, error: String(error.message || error).slice(0, 250),
    last_attempt_at: attempted};
}

async function fetchSource(name) {
  const url = ORIGIN + name;
  const response = await fetch(url, {signal: AbortSignal.timeout(18000), cache: 'no-store'});
  if (!response.ok) throw Error(name + ': HTTP ' + response.status);
  const raw = await response.arrayBuffer();
  if (raw.byteLength > 4000000) throw Error(name + ': oversized response');
  const digest = await crypto.subtle.digest('SHA-256', raw);
  const sha256 = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  return {name, url, sha256, last_modified: response.headers.get('last-modified'), text: new TextDecoder().decode(raw)};
}

async function refresh(previous, attempted) {
  try {
    const files = await Promise.all(SOURCES.map(fetchSource));
    const data = normalize(Object.fromEntries(files.map(f => [f.name, f.text])));
    if (data.matches.length < previous.matches.length * 0.9) throw Error('Season coverage fell by more than 10%');
    const sources = files.map(({text, ...meta}) => meta);
    const success = new Date().toISOString();
    return {...data, sources, snapshot_id: await snapshotId(sources), data_origin: 'provider',
      status: 'ok', last_origin_success_at: success, last_success_at: success, last_origin_attempt_at: attempted,
      last_attempt_at: attempted, error: null, error_stage: null};
  } catch (error) {
    return {...stale(previous, 'upstream', error, attempted), last_origin_attempt_at: attempted};
  }
}

async function season(bucket) {
  const attempted = new Date().toISOString();
  let stored, previous;
  try {
    if (!bucket) throw Error('Season snapshot storage is unavailable');
    stored = await bucket.get(seasonKey);
    if (stored) {
      previous = await stored.json();
      if (!previous?.matches?.length || !previous.audit || !previous.snapshot_id) throw Error('Invalid stored snapshot');
    }
  } catch (error) {
    return stale(await fallback(), 'storage_read', error, attempted);
  }
  if (!stored) previous = await fallback();
  const age = Date.now() - Date.parse(previous.last_attempt_at);
  if (stored && age >= 0 && age < TTL * 1000) return previous;

  const next = await refresh(previous, attempted);
  try {
    // A slower concurrent refresh must never overwrite an already committed snapshot.
    const onlyIf = new Headers(stored ? {'If-Match': stored.httpEtag} : {'If-None-Match': '*'});
    const saved = await bucket.put(seasonKey, JSON.stringify(next), {
      onlyIf, httpMetadata: {contentType: 'application/json'}
    });
    if (saved) return next;
    const winner = await bucket.get(seasonKey);
    if (!winner) throw Error('Concurrent snapshot no longer available');
    return await winner.json();
  } catch (error) {
    return {...stale(previous, 'storage_write', error, attempted), last_origin_attempt_at: attempted};
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', {status: 405});
    if (url.pathname !== '/api/season') return asset(url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname));
    const data = await season(env?.BUCKET);
    return new Response(request.method === 'HEAD' ? null : JSON.stringify({...data, refresh_seconds: TTL,
      served_at: new Date().toISOString(), refresh_mode: 'On demand; open pages check every 5 minutes.'}), {
      headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}
    });
  }
};
