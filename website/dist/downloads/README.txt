CourtEdge 2026 research snapshot
Data through 2026-10-22. This is not the full 2026 season.

Source: TennisMyLife, https://stats.tennismylife.org/tennis-match-database
Fixtures and API demo: https://tennisstats.com/
Kaggle: https://www.kaggle.com/code/jerry871gws2/2026-tennis-fatigue-and-win-prediction

Use the notebook to reproduce the analysis. models.json contains unscaled coefficients for both final models; probability is sigmoid(sum(feature * coefficient)). Match durations and match counts are prior same-event workload, not direct fatigue measurements. Both players need known prior main-draw history. Predictions are conditional on standard completed matches.

The raw date field mixes match dates and tournament start dates. Do not derive exact rest time. The whole-source record count is 5,054; standard completed records total 4,874; the eligible model sample is 1,578. The independent test has 174 matches.

Keep this package for private research and observe original source terms before redistributing raw data.
