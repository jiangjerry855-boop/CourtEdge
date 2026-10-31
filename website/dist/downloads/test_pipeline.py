"""Meaningful checks for time leakage, score parsing and prediction symmetry."""
import numpy as np
import pandas as pd
from analysis import load_data,make_features,fit,probability,BASE,LOAD,parse_score
from tennisstats_client import normalize_match,TennisStats
import json
from pathlib import Path

d,_=load_data();f=make_features(d)
eligible=f[(f.season==2026)&f.eligible]
assert len(eligible)>100
assert parse_score('6-4 6-4',3)=={'sets':2,'games':20}
assert parse_score('6-4 0-0',3) is None
assert parse_score('6-4 2-1 RET',3) is None
assert parse_score('7-6(5) 4-6 6-3',3)=={'sets':3,'games':32}
# Alter a final's duration and score; no pre-match features for that event may change.
target=d[(d.season==2026)&(d['round']=='F')&d.valid_score].iloc[0]
edited=d.copy();mask=(edited.event==target.event)&(edited['round']=='F')
edited.loc[mask,'minutes']=599
f2=make_features(edited)
cols=BASE+LOAD
pd.testing.assert_frame_equal(f.set_index('match_id')[cols],f2.set_index('match_id')[cols])
# Changing first-round workload should affect later rounds, never its own round.
first=d[(d.event==target.event)&d.valid_score].sort_values('rn').iloc[0]
edited=d.copy();mask=(edited.event==first.event)&(edited['round']==first['round'])
edited.loc[mask,'minutes']=599
f3=make_features(edited)
x=f[f.event==first.event].set_index('match_id');z=f3[f3.event==first.event].set_index('match_id')
pd.testing.assert_frame_equal(x[x.rn==first.rn][cols],z[z.rn==first.rn][cols])
assert not np.allclose(x.prior_hours_a,z.prior_hours_a,equal_nan=True)
m=fit(eligible.head(400),cols)
v=eligible.tail(100).copy();p=probability(m,v,cols);v[cols]=-v[cols]
assert np.allclose(p+probability(m,v,cols),1,atol=1e-12)
# Demo validation does not imply whole-season access.
demo=json.loads((Path(__file__).parent/'demo_match.json').read_text())
r=normalize_match(demo['data']);assert r['home_name']=='Carlos Alcaraz' and r['away_name']=='Jannik Sinner'
assert r['sets']==2 and r['games']==22 and r['minutes'] is None
try:TennisStats('testkey').get('matches-list',season_master_id=30428,page=1)
except ValueError:pass
else:raise AssertionError('Demo restrictions not enforced')
print('PASS: score validation, no same/future-round workload leakage, swap symmetry, demo schema, demo access boundary')
