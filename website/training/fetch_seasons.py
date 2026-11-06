"""Cache TennisMyLife tour-level season files locally for a reproducible research fit."""
import argparse
import concurrent.futures
import hashlib
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://stats.tennismylife.org/data/"
FILES = [f"{year}{suffix}.csv" for year in range(2016, 2027) for suffix in ("", "_wta")]
FILES.extend(["ongoing_tourneys.csv", "wta_ongoing_tourneys.csv"])


def fetch(name, directory):
    url = BASE + name
    with urllib.request.urlopen(url, timeout=40) as response:
        payload = response.read()
        modified = response.headers.get("Last-Modified")
    if b"winner_id" not in payload.splitlines()[0]:
        raise ValueError(f"Invalid header: {url}")
    (directory / name).write_bytes(payload)
    return dict(file=name, url=url, bytes=len(payload), last_modified=modified,
                fetched_at=datetime.now(timezone.utc).isoformat(),
                sha256=hashlib.sha256(payload).hexdigest())


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("directory", type=Path)
    directory = parser.parse_args().directory
    directory.mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        manifest = list(pool.map(lambda x: fetch(x, directory), FILES))
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"Verified {len(manifest)} source files, {sum(s['bytes'] for s in manifest):,} bytes")
