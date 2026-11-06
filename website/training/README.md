# CourtEdge win model

Use Python 3.12 with NumPy. Run these steps from the project root. The input directory is outside the published site.

    python training/fetch_seasons.py ../training-input
    python training/train.py ../training-input dist/data/season-model.json --as-of 2026-11-05
    node build.mjs

The first step fetches the 2016–2026 annual ATP and WTA files and both ongoing-event feeds from TennisMyLife. The manifest records source URLs, byte counts, retrieval timestamps and SHA-256 hashes. For an exact rerun, supply the cached CSVs and corresponding manifest. The provider can revise historical files.

The target is victory conditional on standard completion, among ranked players in knockout singles on hard, clay and grass. Matches are oriented by sorted player IDs. Each candidate fits a logistic regression with zero intercept and L2 penalty 4. The fixed 2025 validation rule selects the lowest log loss among rank/context, rank/context plus overall and surface Elo, and the same ratings model plus prior event hours. Elo starts at 1500 with K=24. Both ratings are divided by 400 before fitting. Workload uses a signed difference in earlier completed rounds, capped at five hours in either direction. Unknown workload contributes zero to the score adjustment.

Chronological splits keep events intact and withhold boundary events until the 21-day reporting window clears. The selected model is refitted on eligible events available before January 2026. Its coefficients are frozen for the 2026 backtest. Ratings can learn from previous test events once released. The report includes a paired 2,000-resample event bootstrap for the log loss difference versus rank-only, tour breakdowns and favorite-probability calibration bins. Accuracy gives half credit for a 50–50 tie.

The held-out workload comparison refits rankings plus Elo with and without earlier-round hours on identical training rows. It reports both log losses and a paired, event-bootstrap interval on identical test matches.

The published calculator uses player profiles from the dated build, with editable pre-match ranks. Probabilities apply to hypothetical matches played after the snapshot. Rebuild profiles on newer data for later forecasts. Public data access is for educational, noncommercial research under the provider's terms.
