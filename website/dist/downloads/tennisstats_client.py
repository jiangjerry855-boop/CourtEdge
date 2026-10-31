"""Official TennisStats API adapter. Credentials never appear in output/cache names.
Only documented demo requests are permitted with testkey.
"""
import os,json,time,re,hashlib
from pathlib import Path
from urllib.request import urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError,URLError
from datetime import datetime,timezone

API='https://api.tennisstats.com/'
DEMO={('match-details',(('event_id','971951'),)),('upcoming-matches-list',()),('matches-list',(('page','1'),('unique_tournament_id','31431'))),('season-list',(('page','1'),('tournament_master_id','1887')))}

def secret():
    key=os.environ.get('TENNISSTATS_API_KEY')
    if not key:
        try:
            from kaggle_secrets import UserSecretsClient
            key=UserSecretsClient().get_secret('TENNISSTATS_API_KEY')
        except Exception:pass
    if not key:raise RuntimeError('Add TENNISSTATS_API_KEY to Kaggle Secrets or environment; do not paste it into the notebook.')
    return key

class TennisStats:
    def __init__(self,key=None,cache='tennisstats_cache'):
        self._key=key or secret();self.cache=Path(cache);self.cache.mkdir(parents=True,exist_ok=True);self.last=0
    def get(self,endpoint,**params):
        if endpoint not in {'match-details','matches-list','season-list','upcoming-matches-list'}:raise ValueError('Unsupported endpoint')
        sig=(endpoint,tuple(sorted((k,str(v)) for k,v in params.items())))
        if self._key=='testkey' and sig not in DEMO:raise ValueError('testkey supports only official documented demo URLs; use your account key for history.')
        # Cache contains data only. Its hash is computed without credentials.
        name=hashlib.sha256(json.dumps(sig).encode()).hexdigest()+'.json'
        path=self.cache/name
        if path.exists() and endpoint!='upcoming-matches-list':return json.loads(path.read_text())
        time.sleep(max(0,1.1-(time.monotonic()-self.last)))
        url=API+endpoint+'?'+urlencode(dict(params,key=self._key))
        try:
            with urlopen(url,timeout=45) as r:data=json.load(r)
        except HTTPError as e:raise RuntimeError(f'TennisStats request failed with HTTP {e.code}; endpoint={endpoint}') from None
        except (URLError,ValueError):raise RuntimeError(f'TennisStats request failed; endpoint={endpoint}') from None
        finally:self.last=time.monotonic()
        if not data.get('success'):raise RuntimeError(f'TennisStats rejected request; endpoint={endpoint}. Check your plan/key.')
        path.write_text(json.dumps(data,ensure_ascii=False));return data
    def pages(self,endpoint,**params):
        page=1
        while True:
            data=self.get(endpoint,page=page,**params)
            yield from data['data']
            pager=data.get('pager',{})
            if 'max_page' not in pager:raise RuntimeError('Missing pagination metadata; refusing to claim a complete export.')
            if page>=int(pager['max_page']):break
            page+=1
            if page>10000:raise RuntimeError('Pagination limit reached')
    def seasons(self,years=(2025,2026)):
        return [s for s in self.pages('season-list') if int(s.get('year',0)) in years]
    def completed(self,season_id):
        return [m for group in self.pages('matches-list',season_master_id=season_id) for m in group['matches']]
    def future(self):
        now=datetime.now(timezone.utc).timestamp()
        data=self.get('upcoming-matches-list') if self._key=='testkey' else {'data':list(self.pages('upcoming-matches-list'))}
        return [m for g in data['data'] for m in g['matches'] if m.get('match_type')=='single' and float(m.get('unix_start_time') or 0)>now and not m.get('winner') and not m.get('livescore_json') and not m.get('isfinished')]

def normalize_match(m):
    """Preserve provider IDs/timestamps; unknown durations stay null, never zero."""
    if m.get('match_type')!='single':return None
    pairs=[]
    for part in m.get('json_final_score') or []:
        for key,val in part.items():
            if re.fullmatch('set[1-5]',key):pairs.append((int(key[3:]),int(val['home']),int(val['away'])))
    pairs.sort()
    return dict(provider='TennisStats',match_id=m['id'],home_id=m.get('home_player1_id'),away_id=m.get('away_player1_id'),home_name=m.get('home_player_names',m.get('home_player1_name')),away_name=m.get('away_player_names',m.get('away_player1_name')),scheduled_start_utc=datetime.fromtimestamp(m['unix_start_time'],timezone.utc).isoformat(),surface=m.get('groundType'),tournament=m.get('tournament_name'),season_id=m.get('season_master_id'),event_id=m.get('unique_tournament_master_id'),winner=m.get('winner'),sets=len(pairs),games=sum(a+b for _,a,b in pairs),score_home=' '.join(f'{a}-{b}' for _,a,b in pairs),minutes=None)

def export_seasons(client,destination,years=(2025,2026)):
    """Account-key full export; credentials required. Never run automatically with demo."""
    if client._key=='testkey':raise ValueError('Full export requires account API key')
    dest=Path(destination);dest.mkdir(parents=True,exist_ok=True);rows={};seasons=client.seasons(years)
    for s in seasons:
        for raw in client.completed(s['id']):
            row=normalize_match(raw)
            if row:row.update(tour='ATP' if s['gender']=='men' else 'WTA',year=s['year']);rows[row['match_id']]=row
    out={'retrieved_at':datetime.now(timezone.utc).isoformat(),'source':'TennisStats API','seasons':len(seasons),'matches':list(rows.values()),'limitations':'scheduled time is not measured actual start/end; duration is absent from documented list schema'}
    (dest/'completed_matches.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
    return {'seasons':len(seasons),'matches':len(rows)}

if __name__=='__main__':
    c=TennisStats('testkey');row=normalize_match(c.get('match-details',event_id=971951)['data'])
    print(json.dumps(row,ensure_ascii=False,indent=2))
    print('Future demo fixtures:',len(c.future()))
