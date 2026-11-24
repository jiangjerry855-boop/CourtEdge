# CourtEdge: Tennis Workload & Win Prediction

CourtEdge is a tennis data science portfolio project. It uses ATP and WTA match records to study whether prior time on court helps predict the winner, and it compares rank-based and Elo-based models on matches not used to fit the model.

In the November 5, 2026 experiment, adding workload to rankings and Elo moved held-out log loss from **0.61351** to **0.61361** across **4,871** matches. The 95% event-bootstrap interval for the difference was **−0.00075 to +0.00097**; both players had usable workload in 1,675 matches. The small difference did not establish a predictive improvement. Prior time on court is a proxy, not a direct measurement of fatigue or a causal estimate.

## What's here

- `analysis.py`, `predict_fixtures.py`, and `tennisstats_client.py`: historical analysis, fixture predictions, and optional TennisStats adapter.
- `website/training/`: official-source acquisition and chronological training/evaluation.
- `website/`: data-free portfolio build plus the source of the local-only research interface.
- `test_pipeline.py` and `website/test*.mjs`: reproducibility and validation checks; some require separately acquired data.

The public source tree does **not** include raw CSVs, player/match-level exports, archives, model snapshots, or the data-embedded notebook. Provider downloads and generated data are local only. The prior October 22 snapshot and exact October holdout and fixture results cannot be reconstructed from today's provider download unless the original private inputs are available.

## Obtain data directly from the provider

Review the [TennisMyLife database and its usage terms](https://stats.tennismylife.org/tennis-match-database). Source files are available there for personal, educational, and non-commercial research under its current public terms. Those terms do not authorize redistributing the raw CSVs. Do not publish local snapshots, bundled copies, or row-level outputs. The code here does not grant any new rights to provider data.

With Python 3.12, from the repository root:

```sh
python -m venv .venv
# Linux/macOS: source .venv/bin/activate
# Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python website/training/fetch_seasons.py raw --2026-only
```

This fetches the official ATP and WTA 2026 season and ongoing-event feeds into the ignored `raw/` directory and records URL, retrieval time and SHA-256 for each. You can also download those files directly from the provider page into `raw/` as `2026.csv`, `2026_wta.csv`, `ongoing_tourneys.csv`, and `wta_ongoing_tourneys.csv`. The files can change; use a consistent snapshot and record its retrieval time.

See [model training](website/training/README.md) for the multi-season workflow and [website documentation](website/README.md) for the data-free build and limits of local reproduction. Optional [TennisStats](https://tennisstats.com/api/documentations) access uses your own credentials; do not commit keys or provider responses.
