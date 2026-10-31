# CourtEdge website

The complete English static application is in `dist/`. No build or npm installation is required.

From the repository root:

```bash
python -m http.server 8000 --directory website/dist
```

Open http://localhost:8000. The app loads its bundled data over HTTP; do not open index.html directly as a file.

Run the JavaScript inference and data checks with `node website/test.mjs`.
After reproducing analysis outputs, regenerate web assets with `python website/prepare_data.py`.
The export script uses paths relative to this repository and does not require the original authoring workspace.

The application performs inference locally in the browser. It does not contain an account API key or fetch a live match feed.
