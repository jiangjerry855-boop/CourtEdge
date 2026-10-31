"""TennisStats fixture + current rank joined to TML pre-match workload.
Frozen forecast made with a 2026-10-22 history snapshot. No live-update claim.
"""
import json
import numpy as np
import pandas as pd
from pathlib import Path
from analysis import ROOT,BASE,LOAD,load_data,make_features,fit,probability,norm
from tennisstats_client import normalize_match

def generate(root=ROOT):
    d,_=load_data(root);features=make_features(d)
    eligible=features[(features.season==2026)&features.eligible]
    model_metrics=pd.read_csv(root/'outputs'/'model_metrics.csv').set_index('model')
    models={label:fit(eligible,cols,float(model_metrics.loc[label,'C'])) for label,cols in [('strength',BASE),('strength_workload',BASE+LOAD)]}
    fixtures=json.loads((root/'fixtures_2026-10-23.json').read_text())['fixtures'];rows=[]
    for fixture in fixtures:
        event=d[(d.season==2026)&(d.tour==fixture['tour'])&(d.tourney_name==fixture['event'])].copy()
        if event.event.nunique()!=1:raise ValueError('Ambiguous event join')
        if not event.rn.max()==4:raise ValueError('Snapshot must end in round of 16')
        v=dict(date=fixture['date'],tour=fixture['tour'],event=fixture['event'],round='QF',name_a=fixture['a'],name_b=fixture['b'],source=fixture['url'])
        for side in ['a','b']:
            name=fixture[side];h=event[(event.winner_name.map(norm)==norm(name))|(event.loser_name.map(norm)==norm(name))].sort_values('rn')
            if len(h)==0 or h.iloc[-1]['round']!='R16' or norm(h.iloc[-1].winner_name)!=norm(name):raise ValueError('Missing prior-round winner')
            if not h.valid_score.all() or h.minutes.isna().any():raise ValueError('Incomplete prior workload')
            if h.rn.duplicated().any() or h.rn.max()-h.rn.min()+1!=len(h):raise ValueError('Prior-round gap')
            # Match by full normalized name only, then require a single provider ID.
            ids=[]
            for _,r in h.iterrows():ids.append(r.winner_id if norm(r.winner_name)==norm(name) else r.loser_id)
            if len(set(ids))!=1:raise ValueError('Ambiguous player join')
            last=h.iloc[-1];v['id_'+side]=fixture['tour']+':'+ids[-1]
            if int(last.winner_rank)!=fixture['rank_'+side]:raise ValueError('Cross-source current-rank mismatch')
            v['rank_'+side]=fixture['rank_'+side];v['log_rank_'+side]=np.log(v['rank_'+side]);v['age_'+side]=last.winner_age
            v['qualifier_'+side]=int(str(last.winner_entry) in ['Q','LL']);v['prior_hours_'+side]=h.minutes.sum()/60;v['prior_matches_'+side]=len(h);v['prior_sets_'+side]=h.sets.sum()
        for key in ['log_rank','age','qualifier','prior_hours','prior_matches']:v[key+'_diff']=v[key+'_a']-v[key+'_b']
        for suffix,cond in [('wta',fixture['tour']=='WTA'),('clay',False),('grass',False),('bo5',False),('late',True)]:v['rank_x_'+suffix]=v['log_rank_diff']*cond
        frame=pd.DataFrame([v])
        for label,cols in [('strength',BASE),('strength_workload',BASE+LOAD)]:v['p_a_'+label]=float(probability(models[label],frame,cols)[0])
        v['forecast_status']='experimental; history frozen at 2026-10-22; conditional on completed standard match'
        rows.append(v)
    output=pd.DataFrame(rows);output.to_csv(root/'outputs'/'upcoming_predictions_2026-10-23.csv',index=False)
    # Real official API sample: reconcile names, winner, score and surface with TML.
    api=normalize_match(json.loads((root/'demo_match.json').read_text())['data'])
    match=d[(d.season==2026)&(d.winner_name.map(norm)==norm(api['away_name']))&(d.loser_name.map(norm)==norm(api['home_name']))&(d.surface.str.lower()==api['surface'])]
    match=match[(match.date_field-pd.Timestamp(api['scheduled_start_utc']).tz_localize(None).normalize()).abs().dt.days<=1]
    if len(match)!=1:raise ValueError('API demo did not reconcile uniquely')
    r=match.iloc[0]
    assert r.sets==api['sets'] and r.games==api['games']
    audit=dict(official_api_demo_reconciled=True,tennisstats_match_id=api['match_id'],tml_event=r.event,sets=int(r.sets),games=int(r.games),tml_minutes=float(r.minutes),full_tennisstats_history_loaded=False,fixture_rows_joined=len(output),provider_ids_are_distinct=True)
    (root/'outputs'/'tennisstats_integration.json').write_text(json.dumps(audit,indent=2))
    print(output[['event','name_a','name_b','prior_hours_a','prior_hours_b','p_a_strength','p_a_strength_workload']].to_string(index=False));print(json.dumps(audit,indent=2))
    return output

if __name__=='__main__':generate()
