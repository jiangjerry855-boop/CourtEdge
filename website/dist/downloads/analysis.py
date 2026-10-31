"""2026 tennis: within-event workload and pre-match win probability.
Dates in TML have mixed semantics: NEVER derive rest days from tourney_date.
"""
from pathlib import Path
from collections import defaultdict
import json, re, hashlib, unicodedata
import numpy as np
import pandas as pd
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, accuracy_score, roc_auc_score, brier_score_loss
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

SEED=20261023
ORDER={'R128':1,'R64':2,'R32':3,'R16':4,'QF':5,'SF':6,'F':7}
BASE=['log_rank_diff','age_diff','qualifier_diff','rank_x_wta','rank_x_clay','rank_x_grass','rank_x_bo5','rank_x_late']
LOAD=['prior_hours_diff','prior_matches_diff']
ROOT=Path(__file__).resolve().parent

def norm(s):
    return re.sub(r'[^a-z0-9]+',' ',unicodedata.normalize('NFKD',str(s)).encode('ascii','ignore').decode().lower()).strip()

def parse_score(score,best_of):
    """Return completed standard-set workload; reject retirement, WO, short sets."""
    s=str(score).strip()
    if re.search(r'RET|W/O|DEF|ABD|WALK',s,re.I):return None
    tokens=s.split(); pairs=[]
    for token in tokens:
        m=re.fullmatch(r'(\d+)-(\d+)(?:\(\d+\))?',token)
        if not m:return None
        a,b=map(int,m.groups())
        if not ((max(a,b)==6 and min(a,b)<=4) or (max(a,b)==7 and min(a,b) in (5,6))):return None
        pairs.append((a,b))
    need=int(best_of)//2+1
    if sum(a>b for a,b in pairs)!=need or sum(b>a for a,b in pairs)>=need:return None
    return {'sets':len(pairs),'games':sum(a+b for a,b in pairs)}

def load_data(root=ROOT):
    frames=[]
    for file in ['2026.csv','2026_wta.csv','ongoing_tourneys.csv','wta_ongoing_tourneys.csv']:
        d=pd.read_csv(root/'raw'/file,dtype={'winner_id':str,'loser_id':str,'tourney_id':str})
        d['tour']='WTA' if 'wta' in file else 'ATP';d['source_file']=file
        d['season']=2025 if file.startswith('2025') else 2026
        frames.append(d)
    d=pd.concat(frames,ignore_index=True)
    d['event']=d.tour+':'+d.tourney_id
    d['date_field']=pd.to_datetime(d.tourney_date.astype(str),format='%Y%m%d',errors='coerce')
    d['event_start']=d.groupby('event').date_field.transform('min')
    d['rn']=d['round'].map(ORDER)
    d['parsed']=[parse_score(s,b) if b in (3,5) else None for s,b in zip(d.score,d.best_of)]
    d['valid_score']=d.parsed.notna()
    d['sets']=d.parsed.map(lambda x:x['sets'] if x else np.nan)
    d['games']=d.parsed.map(lambda x:x['games'] if x else np.nan)
    d['minutes']=pd.to_numeric(d.minutes,errors='coerce').where(lambda x:x.between(20,600))
    d['pair']=d.apply(lambda r:'|'.join(sorted([str(r.winner_id),str(r.loser_id)])),axis=1)
    duplicate=d.duplicated(['event','round','pair'],keep='last')
    d['duplicate']=duplicate
    return d[~duplicate].copy(),{'raw_rows':len(d),'duplicates':int(duplicate.sum())}

def make_features(d):
    """Use only earlier knockout rounds in same event; no approximate daily ordering."""
    rows=[]
    for event,g in d.dropna(subset=['rn']).groupby('event',sort=True):
        hist=defaultdict(list)
        for rn,round_matches in g.groupby('rn',sort=True):
            for r in round_matches.to_dict('records'):
                sides=sorted([('w',str(r['winner_id'])),('l',str(r['loser_id']))],key=lambda x:x[1])
                v={k:r[k] for k in ['event','tour','season','event_start','round','rn','surface','best_of','tourney_name','score','valid_score','source_file']}
                v['match_id']=hashlib.sha256(f"{event}|{r['round']}|{r['pair']}".encode()).hexdigest()[:20]
                v['y']=int(sides[0][0]=='w')
                v['history_complete']=True
                for side,(wl,pid) in zip(['a','b'],sides):
                    prefix='winner' if wl=='w' else 'loser';hh=hist[pid]
                    v['id_'+side]=r['tour']+':'+pid;v['name_'+side]=r[prefix+'_name']
                    rank=pd.to_numeric(r[prefix+'_rank'],errors='coerce')
                    age=pd.to_numeric(r[prefix+'_age'],errors='coerce')
                    v['rank_'+side]=rank;v['age_'+side]=age
                    v['log_rank_'+side]=np.log(rank) if rank>0 else np.nan
                    v['qualifier_'+side]=int(str(r[prefix+'_entry']) in ['Q','LL'])
                    v['prior_matches_'+side]=len(hh)
                    v['prior_hours_'+side]=sum(x['minutes'] for x in hh)/60 if all(pd.notna(x['minutes']) for x in hh) else np.nan
                    v['prior_sets_'+side]=sum(x['sets'] for x in hh) if all(x['valid_score'] for x in hh) else np.nan
                    v['prior_games_'+side]=sum(x['games'] for x in hh) if all(x['valid_score'] for x in hh) else np.nan
                    # Consecutive rounds must be represented. First-round byes are allowed.
                    if hh and (hh[-1]['rn']!=rn-1 or any(x['rn']!=hh[0]['rn']+i for i,x in enumerate(hh))):v['history_complete']=False
                    # An unplayed walkover or retirement makes total prior workload uncertain.
                    if any(not x['valid_score'] for x in hh):v['history_complete']=False
                for key in ['log_rank','age','qualifier','prior_matches','prior_hours','prior_sets','prior_games']:
                    v[key+'_diff']=v[key+'_a']-v[key+'_b']
                rank=v['log_rank_diff']
                for suffix,cond in [('wta',v['tour']=='WTA'),('clay',v['surface']=='Clay'),('grass',v['surface']=='Grass'),('bo5',v['best_of']==5),('late',v['round'] in ['QF','SF','F'])]:v['rank_x_'+suffix]=rank*cond
                rows.append(v)
            # Commit results after the entire round has been featurized.
            for r in round_matches.to_dict('records'):
                for key in ['winner_id','loser_id']:hist[str(r[key])].append(r)
    f=pd.DataFrame(rows)
    f['eligible']=f.valid_score & f.history_complete & (f.prior_matches_a>0)&(f.prior_matches_b>0)&f[BASE+LOAD].notna().all(axis=1)
    return f

def fit(d,cols,c=1):
    x=d[cols].to_numpy(float);y=d.y.to_numpy(int)
    m=make_pipeline(StandardScaler(with_mean=False),LogisticRegression(C=c,fit_intercept=False,max_iter=1500))
    m.fit(np.vstack([x,-x]),np.r_[y,1-y]);return m
def probability(m,d,cols):return m.predict_proba(d[cols].to_numpy(float))[:,1]
def metrics(y,p):
    return dict(n=len(y),accuracy=float(accuracy_score(y,p>=.5)),auc=float(roc_auc_score(y,p)),log_loss=float(log_loss(y,p)),brier=float(brier_score_loss(y,p)))
def loss_vec(y,p):
    p=np.clip(p,1e-10,1-1e-10);return -(y*np.log(p)+(1-y)*np.log(1-p))

def run(root=ROOT,reps=500):
    out=root/'outputs';out.mkdir(exist_ok=True)
    d,audit=load_data(root);f=make_features(d)
    f.to_csv(out/'prematch_features.csv',index=False)
    f26=f[f.season==2026];eligible=f26[f26.eligible].copy()
    exclusions=f26[['match_id','event','round','name_a','name_b']].copy();exclusions['reason']='included'
    for mask,reason in [(~f26.valid_score,'nonstandard_or_incomplete_score'),(~f26.history_complete,'incomplete_prior_round_history'),((f26.prior_matches_a==0)|(f26.prior_matches_b==0),'one_or_both_without_prior_main_draw_match'),(f26[['prior_hours_a','prior_hours_b']].isna().any(axis=1),'missing_prior_duration'),(f26[BASE].isna().any(axis=1),'missing_rank_or_age')]:
        exclusions.loc[mask & exclusions.reason.eq('included'),'reason']=reason
    exclusions.to_csv(out/'sample_exclusions.csv',index=False)
    # WTA dates may denote event start. Purge a conservative 21-day event window
    # from the earlier split so late tournament results cannot train an earlier test.
    eligible['event_end_bound']=eligible.event_start+pd.Timedelta(days=21)
    train=eligible[eligible.event_end_bound<'2026-07-01']
    valid=eligible[(eligible.event_start>='2026-07-01')&(eligible.event_end_bound<'2026-09-01')]
    test=eligible[eligible.event_start>='2026-09-01'].copy()
    if min(len(train),len(valid),len(test))<30:raise ValueError('Insufficient chronological samples')
    dev=pd.concat([train,valid]);tuning=[];models={};rows=[];best={}
    for label,cols in [('strength',BASE),('strength_workload',BASE+LOAD)]:
        for c in [.01,.1,1,10]:
            m=fit(train,cols,c);tuning.append(dict(model=label,C=c,validation_log_loss=log_loss(valid.y,probability(m,valid,cols))))
        best[label]=min([r for r in tuning if r['model']==label],key=lambda r:r['validation_log_loss'])['C']
        m=fit(dev,cols,best[label]);models[label]=m;p=probability(m,test,cols)
        test['p_'+label]=p;rows.append(dict(model=label,C=best[label],**metrics(test.y,p)))
    pd.DataFrame(rows).to_csv(out/'model_metrics.csv',index=False)
    pd.DataFrame(tuning).to_csv(out/'validation_tuning.csv',index=False)
    test['predicted_winner']=np.where(test.p_strength_workload>=.5,test.name_a,test.name_b)
    test['actual_winner']=np.where(test.y==1,test.name_a,test.name_b)
    test['probability_of_prediction']=np.maximum(test.p_strength_workload,1-test.p_strength_workload)
    test.to_csv(out/'test_predictions.csv',index=False)
    sub=[]
    for tour,g in test.groupby('tour'):
        for label in models:sub.append(dict(tour=tour,model=label,**metrics(g.y,g['p_'+label])))
    pd.DataFrame(sub).to_csv(out/'subgroup_metrics.csv',index=False)
    delta=loss_vec(test.y.to_numpy(),test.p_strength_workload.to_numpy())-loss_vec(test.y.to_numpy(),test.p_strength.to_numpy())
    grouped=pd.DataFrame({'event':test.event,'delta':delta}).groupby('event').delta.agg(['sum','count'])
    rng=np.random.default_rng(SEED);idx=rng.integers(0,len(grouped),(3000,len(grouped)))
    b=grouped['sum'].to_numpy()[idx].sum(1)/grouped['count'].to_numpy()[idx].sum(1)
    comparison={'delta_log_loss':float(delta.mean()),'ci95':np.quantile(b,[.025,.975]).tolist(),'test_events':len(grouped)}
    # Event-cluster bootstrap, fixed regularization selected on validation.
    cols=BASE+LOAD;m=models['strength_workload'];coef=m[-1].coef_[0]/m[0].scale_
    clusters=[g for _,g in dev.groupby('event')];samples=[]
    for i in range(reps):
        dd=pd.concat([clusters[j] for j in rng.integers(0,len(clusters),len(clusters))],ignore_index=True)
        mm=fit(dd,cols,best['strength_workload']);samples.append(mm[-1].coef_[0]/mm[0].scale_)
    samples=np.array(samples);associations=[]
    for name in LOAD:
        i=cols.index(name);lo,hi=np.quantile(np.exp(samples[:,i]),[.025,.975]);associations.append(dict(feature=name,odds_ratio=float(np.exp(coef[i])),ci_low=lo,ci_high=hi,bootstrap_reps=reps))
    pd.DataFrame(associations).to_csv(out/'adjusted_associations.csv',index=False)
    # Snapshot counts describe recorded completed standard matches, not all tour coverage.
    counted=d[(d.season==2026)&d.valid_score]
    summary_counts=counted.groupby('tour').agg(matches=('score','size'),events=('event','nunique'),median_minutes=('minutes','median'),duration_available=('minutes','count'))
    summary_counts.to_csv(out/'tour_statistics_2026.csv')
    people=[]
    for side,won in [('winner',1),('loser',0)]:
        z=counted[['tour',side+'_id',side+'_name','minutes']].rename(columns={side+'_id':'player_id',side+'_name':'player'});z['win']=won;people.append(z)
    people=pd.concat(people);player=people.groupby(['tour','player_id','player']).agg(matches=('win','size'),wins=('win','sum'),recorded_minutes=('minutes','sum'),duration_available=('minutes','count')).reset_index();player['win_rate']=player.wins/player.matches
    player.sort_values(['tour','wins'],ascending=[True,False]).to_csv(out/'player_statistics_2026.csv',index=False)
    audit.update(season_2026_raw=int((d.season==2026).sum()),completed_standard_2026=len(counted),primary_samples=len(eligible),train=len(train),validation=len(valid),test=len(test),purged_boundary_samples=len(eligible)-len(train)-len(valid)-len(test),purge_days=21,test_events=len(grouped),date_semantics='mixed match-day / tournament start; event-round history only',cutoff='2026-10-22 snapshot',ineligible_2026_knockout=int((~f26.eligible).sum()))
    # Save portable coefficients; future predictions must supply the same verified inputs.
    final=fit(eligible,cols,best['strength_workload']);params={'features':cols,'coefficients':(final[-1].coef_[0]/final[0].scale_).tolist(),'cutoff':audit['cutoff'],'C':best['strength_workload'],'valid_scope':'ATP/WTA standard knockout singles; both have prior main-draw matches in current event'}
    (out/'model_parameters.json').write_text(json.dumps(params,indent=2))
    report={'audit':audit,'metrics':rows,'comparison':comparison,'associations':associations,'source':'TennisMyLife snapshot; TennisStats demo is integration validation only','execution':'Kaggle cloud' if Path('/kaggle/working').exists() else 'local Python; not a Kaggle cloud run'}
    (out/'summary.json').write_text(json.dumps(report,indent=2,ensure_ascii=False))
    fig,axs=plt.subplots(1,2,figsize=(11,4),layout='constrained')
    names=['Strength','Strength + workload'];axs[0].bar(names,[r['log_loss'] for r in rows],color=['#597a92','#199b83']);axs[0].set_ylabel('Test log loss (lower is better)');axs[0].set_ylim(0,.8)
    for j,r in enumerate(rows):axs[0].text(j,r['log_loss']+.015,f"{r['log_loss']:.4f}",ha='center')
    for j,r in enumerate(associations):axs[1].errorbar(r['odds_ratio'],j,xerr=[[r['odds_ratio']-r['ci_low']],[r['ci_high']-r['odds_ratio']]],fmt='o',color='#199b83',capsize=4)
    axs[1].set_yticks([0,1],['+1 prior hour','+1 prior match']);axs[1].axvline(1,color='gray',ls='--');axs[1].set_xlabel('Adjusted odds ratio; event-bootstrap 95% interval')
    fig.suptitle('2026 ATP/WTA: within-event workload proxies');fig.savefig(out/'results.png',dpi=160);plt.close(fig)
    print(json.dumps(report,indent=2,ensure_ascii=False));return report

def predict_verified_features(values,model_path=ROOT/'outputs'/'model_parameters.json'):
    """For a verified future fixture: values are pre-match A minus B differences.
    This deliberately requires complete inputs; it never invents rest days or missing load.
    """
    p=json.loads(Path(model_path).read_text());x=np.array([values[k] for k in p['features']],float)
    if not np.isfinite(x).all():raise ValueError('Missing/nonfinite pre-match input')
    return float(1/(1+np.exp(-np.clip(x@np.array(p['coefficients']),-30,30))))

if __name__=='__main__':run()
