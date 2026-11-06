# CourtEdge website

The Prediction Lab estimates pre-match win probabilities for two ranked ATP or WTA singles players. Its interactive line charts show the effect of changing Player A’s rank and compare predicted and observed favorite win rates by month. The explorer and EDA page use 2026 results from the four TennisMyLife season and ongoing-event files.

## Run locally

From the repository root, use Node.js 24:

    cd website
    node prepare-current.mjs
    node build.mjs
    node serve.mjs

Open <http://127.0.0.1:8000/#predict>. The preparation step needs internet access. It validates all four sources and writes a local fallback snapshot. The local server uses the same refresh handler as the hosted site and exposes its last successful fetch, attempted fetch and any error. The fitted model ships with the source, so these steps do not require Python or model training.

## Source map

| File | Purpose |
| --- | --- |
| `dist/season-predict.js` | Matchup calculator, input validation and browser inference |
| `dist/forecast-charts.js` | Interactive rank-sensitivity and monthly forecast charts |
| `dist/data/season-model.json` | Coefficients, dated player ratings, source manifest and held-out evaluation |
| `training/` | Source acquisition, chronological training and backtesting |
| `live-data.js` and `server.js` | CSV validation, EDA, refresh cache and failure handling |
| `dist/eda-view.js` and `dist/app.js` | EDA, match explorer and research views |

## Verification and training

After preparing and building the snapshot, run `node test.mjs`, `node test-live.mjs` and `node test-ui.mjs` from this directory. For model reproduction, follow [the training instructions](training/README.md). Downloaded training data, refreshed match files and generated Worker bundles stay outside version control.

The November 5 model was fitted on 46,570 pre-2026 matches. On 4,871 held-out 2026 matches it recorded 66.1% accuracy against 64.6% for the rank-only baseline. Ratings belong to that dated model build. The October research files and forecasts have a separate historical cutoff.
