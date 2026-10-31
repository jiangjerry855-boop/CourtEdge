# CourtEdge: Tennis Workload & Win Prediction

An end-to-end tennis data science project: a 2026 ATP/WTA dataset, reproducible Python analysis, an executed Kaggle notebook, an English report, and an interactive website for exploring records and estimating match win probabilities.

**Snapshot date: 22 October 2026.** The four example forecasts are dated 23 October 2026. These are historical research estimates, not a live prediction service or a complete 2026 season census.

- [Website](https://tennis-workload-lab-2026.jiangjerry855.chatgpt.site)
- [Executed Kaggle notebook](https://www.kaggle.com/code/jerry871gws2/2026-tennis-fatigue-and-win-prediction) (private Kaggle notebook; access may be required)
- [English research report](reports/Tennis_Fatigue_2026_Report.pdf)
- [Notebook file](notebooks/tennis_fatigue_2026.ipynb)

## What is included

| Location | Contents |
| --- | --- |
| `raw/` | All four unmodified 2026 source CSVs and their source/hash manifest |
| `outputs/matches_2026.csv` | 5,054 deduplicated match records with source fields and quality flags |
| `outputs/` | Player statistics, pre-match features, exclusion reasons, train/validation/test summaries, bootstrap estimates, model parameters, and predictions |
| `notebooks/` | The executed Kaggle notebook with embedded frozen inputs and outputs |
| `reports/` | English PDF and original Chinese analytical HTML report |
| `website/` | Complete English website source, bundled data, browser model and download files |
| Root Python files | Analysis, forecast generation, TennisStats adapter and validation checks |
| `docs/` | Original research notes and an upload inventory |

## Data at a glance

| Measure | Count |
| --- | ---: |
| Raw source rows | 5,055 |
| Deduplicated records | 5,054 |
| Standard completed singles matches | 4,874 |
| Players represented in completed matches | 732 |
| Workload-model eligible matches | 1,578 |
| Training / validation / independent test | 887 / 187 / 174 |
| Boundary-purged eligible matches | 330 |

The match counts include singles played in team events. Retirements, walkovers and non-standard scores are excluded from the completed-match analysis. The eligible workload sample also requires complete prior event history and pre-match predictors.

## Main result

After adjustment, one additional hour of prior same-event play relative to the opponent was associated with an odds ratio of **0.894** (event-bootstrap 95% interval **0.825-0.984**). This is an association with lower odds, not a causal effect or a 10.6 percentage point decline in win probability.

| Independent test metric | Baseline | Baseline + workload |
| --- | ---: | ---: |
| Accuracy | 60.9% | 60.9% |
| AUC | 0.671 | 0.660 |
| Log loss (lower is better) | 0.6512 | 0.6572 |
| Brier score (lower is better) | 0.2297 | 0.2323 |

Workload did **not** provide a reliable improvement in held-out prediction. The log-loss difference was +0.0060, with a 95% interval from -0.0095 to +0.0272. The independent test contains 174 matches from 16 events.

## Run the website

```bash
python -m http.server 8000 --directory website/dist
```

Open **http://localhost:8000**. Search/filter match records, view player statistics, inspect every match field, export CSVs, and compare baseline versus workload probabilities. The prediction form requires verified pre-match inputs. Missing workload is not silently imputed.

## Reproduce the analysis

Python 3.12 was used for the repository validation environment. The included executed Kaggle notebook records its own original Python environment.

```bash
python -m venv .venv
# macOS / Linux
source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
python test_pipeline.py
python analysis.py
python predict_fixtures.py
python website/prepare_data.py
```

`analysis.py` regenerates local statistical outputs and bootstrap results. `predict_fixtures.py` regenerates the four dated fixture predictions. The frozen inputs are already included, so ordinary reproduction does not require external data downloads. To run the browser inference checks with Node.js:

```bash
node website/test.mjs
```

Alternatively, import `notebooks/tennis_fatigue_2026.ipynb` into Kaggle and run its cells. The notebook embeds its original frozen dataset. The recorded cloud execution succeeded on CPU in 55.7 seconds; local and cloud metrics agreed to 1e-12.

## Modeling choices and limitations

- Regularized logistic regression uses pre-match rank, age, qualifier status, and rank interactions with tour, surface, best-of-five format and late rounds.
- The extended model adds prior same-event hours and match-count differences.
- Only earlier knockout rounds contribute workload. Target-match scores and durations never become predictors.
- Mirrored training ensures complementary probabilities when the two players are swapped.
- Source dates mix match dates and tournament start dates. Exact rest intervals are therefore not estimated. A conservative 21-day buffer separates time-based evaluation partitions.
- Forecasts are conditional on normal completed matches. Injury, travel, sleep, training, doubles and full qualifying workload are not observed.
- Workload is a proxy for fatigue. Opponent strength and selection effects can confound its association with winning. The test sample is small.

## Sources and API connection

- [TennisMyLife match database and field documentation](https://stats.tennismylife.org/tennis-match-database)
- [TennisMyLife source repository](https://github.com/Tennismylife/TML-Database)
- [TennisStats](https://tennisstats.com/) and [official API documentation](https://tennisstats.com/api/documentations)

The official TennisStats demo match and four public fixtures were reconciled with the historical data. Full account-level TennisStats history was not imported. Optional account exports read `TENNISSTATS_API_KEY` from the environment or Kaggle Secrets; no account key is included. The literal `testkey` in the adapter is the provider's public demo key.

Original source terms continue to apply to the raw data; this repository does not grant a new license over third-party records. Review those terms before redistributing data or making a private copy public.
