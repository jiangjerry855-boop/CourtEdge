"""Build the frozen website data from the validated 2026 research outputs."""
from pathlib import Path
import sys, json, shutil, zipfile
import numpy as np
import pandas as pd
SITE=Path(__file__).resolve().parent
SOURCE=SITE.parent
sys.path.insert(0,str(SOURCE))
from analysis import load_data,make_features,fit,BASE,LOAD
OUT=SITE/'dist/data'; OUT.mkdir(parents=True,exist_ok=True)
DOWNLOAD=SITE/'dist/downloads'; DOWNLOAD.mkdir(exist_ok=True)
d,_=load_data(SOURCE); f=make_features(d); eligible=f[f.eligible]
metrics=pd.read_csv(SOURCE/'outputs/model_metrics.csv').set_index('model')
models={}
for key,cols in [('strength',BASE),('strength_workload',BASE+LOAD)]:
    m=fit(eligible,cols,float(metrics.loc[key,'C']))
    models[key]={'features':cols,'coefficients':(m[-1].coef_[0]/m[0].scale_).tolist(),'intercept':0}
models['scope']='ATP/WTA standard knockout singles; both players have prior main-draw matches in the same event'
models['cutoff']='2026-10-22'
(OUT/'models.json').write_text(json.dumps(models))

# Preserve every original raw column in the downloadable and inspectable match table.
fkeys={(r.event,r['round'],'|'.join(sorted([r.id_a.split(':')[1],r.id_b.split(':')[1]]))):bool(r.eligible) for _,r in f.iterrows()}
d['analysis_eligible']=[fkeys.get((r.event,r['round'],r.pair),False) for _,r in d.iterrows()]
d['source_date']=d.date_field.dt.strftime('%Y-%m-%d')
matchcols=[x for x in d.columns if x not in ['parsed','date_field','event_start','rn','pair','duplicate']]
matches=d[matchcols].sort_values(['source_date','tour','tourney_name'],ascending=[False,True,True])
(OUT/'matches.json').write_text(matches.to_json(orient='records'))
matches.to_csv(DOWNLOAD/'matches_2026.csv',index=False)

players=pd.read_csv(SOURCE/'outputs/player_statistics_2026.csv',dtype={'player_id':str})
latest={}
for _,r in d.sort_values(['date_field','rn'],na_position='first').iterrows():
    for side in ['winner','loser']:
        key=r.tour+':'+str(r[side+'_id'])
        latest[key]={'rank':None if pd.isna(r[side+'_rank']) else int(r[side+'_rank']),'age':None if pd.isna(r[side+'_age']) else float(r[side+'_age']),'rank_date':r.source_date,'country':r[side+'_ioc'] if pd.notna(r[side+'_ioc']) else ''}
people=json.loads(players.to_json(orient='records'))
for p in people:
    p['key']=p['tour']+':'+p['player_id'];p.update(latest.get(p['key'],{}))
(OUT/'players.json').write_text(json.dumps(people,allow_nan=False))
fixtures=pd.read_csv(SOURCE/'outputs/upcoming_predictions_2026-10-23.csv')
(OUT/'fixtures.json').write_text(fixtures.to_json(orient='records'))
for name in ['summary.json','kaggle_summary.json','model_parameters.json','tennisstats_integration.json']:
    shutil.copy2(SOURCE/'outputs'/name,OUT/name)
downloadfiles=[]
def copy(src,name,category,description):
    shutil.copy2(src,DOWNLOAD/name)
    downloadfiles.append({'name':name,'category':category,'description':description,'bytes':(DOWNLOAD/name).stat().st_size})
downloadfiles.append({'name':'matches_2026.csv','category':'Matches','description':'All 5,054 deduplicated records, original fields and quality flags.','bytes':(DOWNLOAD/'matches_2026.csv').stat().st_size})
for name,desc in [('player_statistics_2026.csv','Player records for standard completed matches.'),('prematch_features.csv','Pre-match features and eligibility for every knockout match.'),('sample_exclusions.csv','Model exclusions with reasons.'),('test_predictions.csv','174 independent test predictions and actual results.'),('upcoming_predictions_2026-10-23.csv','Four frozen fixture forecasts with verified inputs.'),('model_metrics.csv','Independent test metrics for both models.'),('subgroup_metrics.csv','Test metrics by tour.'),('adjusted_associations.csv','Adjusted odds ratios and bootstrap intervals.'),('validation_tuning.csv','Validation metrics for regularization choices.'),('tour_statistics_2026.csv','Tour counts and duration summary.')]:
    copy(SOURCE/'outputs'/name,name,'Analysis',desc)
for name in ['2026.csv','2026_wta.csv','ongoing_tourneys.csv','wta_ongoing_tourneys.csv']:
    copy(SOURCE/'raw'/name,'raw_'+name,'Raw source','Unmodified TennisMyLife source snapshot.')
manifest=json.loads((SOURCE/'raw/manifest.json').read_text())
(DOWNLOAD/'source_manifest.json').write_text(json.dumps([x for x in manifest if not x['name'].startswith('2025')],indent=2))
copy(SOURCE/'notebooks/tennis_fatigue_2026.ipynb','tennis_fatigue_2026.ipynb','Reproduce','Executed Kaggle notebook with frozen inputs.')
copy(SOURCE/'reports/Tennis_Fatigue_2026_Report.pdf','Tennis_Fatigue_2026_Report.pdf','Report','Three-page English research report.')
for name in ['analysis.py','predict_fixtures.py','tennisstats_client.py','test_pipeline.py']:
    copy(SOURCE/name,name,'Code','Reproducible analysis and integration source.')
for name in ['summary.json','kaggle_summary.json','model_parameters.json','tennisstats_integration.json']:
    copy(SOURCE/'outputs'/name,name,'Analysis','Machine-readable analysis results and provenance.')
copy(SOURCE/'kaggle_run.json','kaggle_run.json','Reproduce','Verified Kaggle execution record.')
shutil.copy2(OUT/'models.json',DOWNLOAD/'models.json')
(DOWNLOAD/'README.txt').write_text('CourtEdge 2026 research snapshot\nData through 2026-10-22. This is not the full 2026 season.\n\nSource: TennisMyLife, https://stats.tennismylife.org/tennis-match-database\nFixtures and API demo: https://tennisstats.com/\nKaggle: https://www.kaggle.com/code/jerry871gws2/2026-tennis-fatigue-and-win-prediction\n\nUse the notebook to reproduce the analysis. models.json contains unscaled coefficients for both final models; probability is sigmoid(sum(feature * coefficient)). Match durations and match counts are prior same-event workload, not direct fatigue measurements. Both players need known prior main-draw history. Predictions are conditional on standard completed matches.\n\nThe raw date field mixes match dates and tournament start dates. Do not derive exact rest time. The whole-source record count is 5,054; standard completed records total 4,874; the eligible model sample is 1,578. The independent test has 174 matches.\n\nKeep this package for private research and observe original source terms before redistributing raw data.\n')
with zipfile.ZipFile(DOWNLOAD/'CourtEdge_2026_Data.zip','w',zipfile.ZIP_DEFLATED) as z:
    for path in DOWNLOAD.iterdir():
        if path.suffix!='.zip': z.write(path,path.name)
(OUT/'downloads.json').write_text(json.dumps(downloadfiles))
assert len(d)==5054 and int(d.valid_score.sum())==4874 and len(eligible)==1578
for _,r in fixtures.iterrows():
    for label,cols in [('strength',BASE),('strength_workload',BASE+LOAD)]:
        z=sum(float(r[k])*v for k,v in zip(models[label]['features'],models[label]['coefficients']))
        assert abs(1/(1+np.exp(-z))-r['p_a_'+label])<1e-12
print(json.dumps({'matches':len(d),'players':len(people),'eligible':len(eligible),'fixture_parity':'passed','download_files':len(downloadfiles)}))
