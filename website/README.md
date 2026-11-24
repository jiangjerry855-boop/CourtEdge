# Website source

## Data-free portfolio

From `website/` with Node.js 24:

```sh
npm run build
npm run test:portfolio
```

The build creates only `portfolio-dist/index.html` and `portfolio-dist/style.css`. It needs no network access, provider files, or model snapshot. Only `portfolio-dist/` is suitable for a public portfolio build. Do not publish `dist/`, `snapshots/`, or `local-build/`.

## Private historical research interface

The app and worker sources are retained for local learning. Their match explorer, downloads and season API expose local research data; don't deploy or expose them on a public interface.

For an exact historical reproduction, supply your own authorized October research inputs in `raw/` along with `demo_match.json`, `fixtures_2026-10-23.json`, and `outputs/kaggle_summary.json` for the full legacy workflow. Those frozen inputs are not available from this repository or recreated merely by downloading the current provider feed. With the original inputs, the sequence from the repository root is:

```sh
python test_pipeline.py
python analysis.py
python predict_fixtures.py
python website/prepare_data.py
```

Then, from `website/`, build the private season model as described in [training/README.md](training/README.md), and run:

```sh
npm run snapshot
npm run build:local
npm run start
```

The research server binds to `127.0.0.1` only. The local mode embeds your local research assets in `local-build/index.js`; it does not create any hosting metadata. `npm test` tests the historical local workflow and expects original generated inputs. `npm run test:portfolio` does not need any research data.
