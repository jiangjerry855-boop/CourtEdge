// Prepare the local fallback snapshot from the same four sources used by the hosted Worker.
import fs from "node:fs/promises";
import {createHash} from "node:crypto";
import {SOURCES, ORIGIN, normalize, analyze, snapshotId} from "./live-data.js";

const sources = await Promise.all(SOURCES.map(async name => {
  const url = ORIGIN + name;
  const response = await fetch(url, {signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw Error(name + ": HTTP " + response.status);
  const text = await response.text();
  return {name, url, text, last_modified: response.headers.get("last-modified"),
    sha256: createHash("sha256").update(text).digest("hex")};
}));
const season = normalize(Object.fromEntries(sources.map(source => [source.name, source.text])));
const timestamp = new Date().toISOString();
const snapshot = {...season, last_success_at: timestamp, last_attempt_at: timestamp,
  status: "packaged", data_origin: "packaged", snapshot_id: await snapshotId(sources),
  last_origin_success_at: null, last_origin_attempt_at: null, error: null, error_stage: null, refresh_seconds: 900,
  sources: sources.map(({text, ...metadata}) => metadata)};

await fs.mkdir("snapshots", {recursive: true});
await Promise.all(sources.map(source => fs.writeFile("snapshots/" + source.name, source.text)));
await fs.writeFile("dist/data/eda.json", JSON.stringify(analyze(season.matches)));
const fields = Object.keys(season.matches[0]);
const cell = value => '"' + String(value ?? '').replaceAll('"','""') + '"';
const rows = season.matches.map(row => fields.map(field => cell(row[field])).join(","));
await fs.writeFile("dist/downloads/current_matches_2026.csv", [fields.join(","), ...rows].join("\n"));
await fs.writeFile("dist/data/current.next.json", JSON.stringify(snapshot));
await fs.rename("dist/data/current.next.json", "dist/data/current.json");
console.log("Prepared " + season.matches.length + " match records.");
