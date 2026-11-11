export const SOURCES=['2026.csv','2026_wta.csv','ongoing_tourneys.csv','wta_ongoing_tourneys.csv'];
export const ORIGIN='https://stats.tennismylife.org/data/';
export function parseCSV(text){
 if(/^\s*</.test(text))throw Error('Source returned HTML instead of CSV');
 const rows=[];let row=[],cell='',quote=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quote&&text[i+1]==='"'){cell+='"';i++;}else quote=!quote;}else if(!quote&&(c===','||c==='\n')){row.push(cell.replace(/\r$/,''));cell='';if(c==='\n'){if(row.some(Boolean))rows.push(row);row=[];}}else cell+=c;}
 if(quote)throw Error('Unterminated CSV quote');if(cell||row.length){row.push(cell.replace(/\r$/,''));rows.push(row);}const header=rows.shift()?.map(x=>x.trim());
 if(!header||header.includes('')||new Set(header).size!==header.length||!['tourney_id','winner_id','loser_id','round','score','best_of','minutes','tourney_date'].every(x=>header.includes(x)))throw Error('Required CSV columns missing');
 return rows.map((r,i)=>{if(r.length!==header.length)throw Error('CSV width mismatch at row '+(i+2));return Object.fromEntries(header.map((k,j)=>[k,r[j]===''?null:r[j]]));});
}
export const CLEANING_VERSION = 3;
const ENTRY_CODES = new Set(['Q', 'WC', 'LL', 'PR', 'SE', 'SR', 'ALT']);

export function score(value, bestOf) {
  if (!value || ![3, 5].includes(Number(bestOf))) return null;
  const target = Math.floor(Number(bestOf) / 2) + 1;
  let wins = 0, losses = 0, games = 0;
  for (const token of value.trim().split(/\s+/)) {
    if (wins === target || losses === target) return null;
    const set = /^(\d+)-(\d+)(?:\(\d+\))?$/.exec(token);
    if (!set) return null;
    const a = Number(set[1]), b = Number(set[2]);
    const high = Math.max(a, b), low = Math.min(a, b);
    if (!((high === 6 && low <= 4) || (high === 7 && (low === 5 || low === 6)))) return null;
    if (a > b) wins++;
    else losses++;
    games += a + b;
  }
  return wins === target ? {sets: wins + losses, games} : null;
}

function cleanNumber(value, changes, field, min, max, integer = true) {
  if (value == null) return null;
  const n = Number(value);
  if (Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isSafeInteger(n))) return n;
  changes[field]++;
  return null;
}

function cleanPlayer(row, side, changes) {
  const entry = side + '_entry', seed = side + '_seed';
  const code = row[entry]?.toUpperCase() ?? null;
  if (code !== row[entry] && row[entry] != null) changes.entryCase++;
  row[entry] = code;
  const seedCode = row[seed]?.toUpperCase();
  if (ENTRY_CODES.has(seedCode) && (!code || code === seedCode)) {
    row[entry] = seedCode;
    row[seed] = null;
    changes.entryFromSeed++;
  } else {
    const rawSeed = row[seed];
    row[seed] = cleanNumber(rawSeed, changes, 'invalidSeed', 1, Infinity);
    if (row[seed] !== null && String(row[seed]) !== rawSeed) changes.seedFormat++;
  }
  row[side + '_ht'] = cleanNumber(row[side + '_ht'], changes, 'invalidHeight', 1, 300);
  row[side + '_rank'] = cleanNumber(row[side + '_rank'], changes, 'invalidRank', 1, Infinity);
  row[side + '_age'] = cleanNumber(row[side + '_age'], changes, 'invalidAge', Number.MIN_VALUE, Infinity, false);
}

function sourceDate(value) {
  if (!/^\d{8}$/.test(value)) return null;
  const iso = value.slice(0, 4) + '-' + value.slice(4, 6) + '-' + value.slice(6);
  const date = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(+date) && date.toISOString().startsWith(iso + 'T') ? iso : null;
}

export function normalize(files) {
  const unique = new Map();
  const changes = {trimmedScores: 0, entryCase: 0, entryFromSeed: 0, seedFormat: 0,
    invalidSeed: 0, invalidHeight: 0, invalidRank: 0, invalidAge: 0, invalidMinutes: 0, invalidBestOf: 0};
  const audit = {cleaningVersion: CLEANING_VERSION, raw: 0, excludedYear: 0, invalidDate: 0, duplicates: 0, changes};
  for (const name of SOURCES) {
    const rows = parseCSV(files[name]);
    if (!rows.length) throw Error('Empty source ' + name);
    audit.raw += rows.length;
    for (const row of rows) {
      const rawScore = row.score;
      for (const field of Object.keys(row)) row[field] = row[field]?.trim() || null;
      const date = sourceDate(row.tourney_date);
      if (!date) { audit.invalidDate++; continue; }
      if (!date.startsWith('2026-')) { audit.excludedYear++; continue; }
      if (!row.tourney_id || !row.winner_id || !row.loser_id || row.winner_id === row.loser_id) {
        throw Error('Invalid match identity in ' + name);
      }
      if (!row.round && !row.match_num) throw Error('Missing round and match number in ' + name);
      row.tour = name.includes('wta') ? 'WTA' : 'ATP';
      row.source_file = name;
      if (rawScore !== row.score) changes.trimmedScores++;
      cleanPlayer(row, 'winner', changes);
      cleanPlayer(row, 'loser', changes);
      row.minutes = cleanNumber(row.minutes, changes, 'invalidMinutes', 20, 600);
      if (row.best_of !== null && ![3, 5].includes(Number(row.best_of))) changes.invalidBestOf++;
      row.best_of = [3, 5].includes(Number(row.best_of)) ? Number(row.best_of) : null;
      const result = score(row.score, row.best_of);
      Object.assign(row, {valid_score: !!result, sets: result?.sets ?? null, games: result?.games ?? null,
        analysis_eligible: null, source_date: date});
      const key = JSON.stringify([row.tour, row.tourney_id, row.round?.toUpperCase() || '#' + row.match_num,
        ...[row.winner_id, row.loser_id].sort()]);
      if (unique.has(key)) audit.duplicates++;
      unique.set(key, row);
    }
  }
  const matches = [...unique.values()].sort((a, b) => b.source_date.localeCompare(a.source_date));
  if (matches.length < 1000) throw Error('Season coverage unexpectedly small');
  return {matches, audit: {...audit, records: matches.length, completed: matches.filter(row => row.valid_score).length}};
}
const quantile=(a,q)=>{if(!a.length)return null;const b=[...a].sort((x,y)=>x-y),p=(b.length-1)*q,i=Math.floor(p);return b[i]+(b[Math.ceil(p)]-b[i])*(p-i);};
const stats=a=>({n:a.length,min:a.length?Math.min(...a):null,q1:quantile(a,.25),median:quantile(a,.5),q3:quantile(a,.75),p95:quantile(a,.95),max:a.length?Math.max(...a):null});
export function correlation(pairs){const n=pairs.length;if(n<3)return {n,r:null};const mx=pairs.reduce((s,p)=>s+p[0],0)/n,my=pairs.reduce((s,p)=>s+p[1],0)/n;let xy=0,xx=0,yy=0;for(const [x,y]of pairs){xy+=(x-mx)*(y-my);xx+=(x-mx)**2;yy+=(y-my)**2;}return {n,r:xx&&yy?xy/Math.sqrt(xx*yy):null};}
export function analyze(matches){const completed=matches.filter(x=>x.valid_score),players=new Map();for(const r of completed)for(const side of ['winner','loser']){const key=r.tour+':'+r[side+'_id'];if(!players.has(key))players.set(key,{key,player_id:r[side+'_id'],player:r[side+'_name'],tour:r.tour,country:r[side+'_ioc'],matches:0,wins:0,recorded_minutes:0,duration_available:0,rank:r[side+'_rank'],age:r[side+'_age'],rank_date:r.source_date});const p=players.get(key);p.matches++;p.wins+=side==='winner';if(r.minutes!==null){p.recorded_minutes+=r.minutes;p.duration_available++;}}
 const people=[...players.values()].map(p=>({...p,win_rate:p.wins/p.matches}));const fields=['minutes','winner_rank','loser_rank','winner_age','loser_age','surface','score'];const missing=Object.fromEntries(fields.map(k=>[k,{missing:matches.filter(r=>r[k]===null||r[k]==='').length,total:matches.length}]));const tours={};for(const tour of ['ATP','WTA']){const rows=completed.filter(r=>r.tour===tour),duration=rows.filter(r=>r.minutes!==null);const ranked=rows.filter(r=>r.winner_rank>0&&r.loser_rank>0&&r.winner_rank!==r.loser_rank);tours[tour]={records:matches.filter(r=>r.tour===tour).length,completed:rows.length,duration:stats(duration.map(r=>r.minutes)),missing_duration:rows.length-duration.length,upsets:ranked.filter(r=>r.winner_rank>r.loser_rank).length,ranked_n:ranked.length,long_matches:rows.filter(r=>r.sets===r.best_of).length,surfaces:Object.fromEntries(['Hard','Clay','Grass','Carpet'].map(s=>[s,rows.filter(r=>r.surface===s).length])),duration_bins:[0,60,90,120,180,240].map((low,i,a)=>({label:i===a.length-1?'240+':`${low}–${a[i+1]-1}`,n:duration.filter(r=>r.minutes>=low&&(i===a.length-1||r.minutes<a[i+1])).length})),duration_games:correlation(duration.map(r=>[r.minutes,r.games])),duration_sets:correlation(duration.map(r=>[r.minutes,r.sets]))};}
 return {total:matches.length,completed:completed.length,nonstandard:matches.length-completed.length,players:people,tours,missing,source_date_range:[...matches.map(r=>r.source_date)].sort().filter((x,i,a)=>i===0||i===a.length-1),workload:stats(people.map(p=>p.matches)),player_workload_win:correlation(people.map(p=>[p.matches,p.win_rate]))};
}

export async function snapshotId(sources) {
  const manifest = sources.map(s => [s.name, s.sha256]).sort(([a], [b]) => a.localeCompare(b));
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([CLEANING_VERSION, manifest])));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
