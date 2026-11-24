import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const site = path.dirname(fileURLToPath(import.meta.url));
export const files = Object.freeze(['index.html', 'style.css']);

export function publicAssets(io = fs, source = path.join(site, 'portfolio')) {
  return Object.fromEntries(files.map(name => [name, io.readFileSync(path.join(source, name))]));
}

export function writePortfolio(io = fs, target = path.join(site, 'portfolio-dist'), source) {
  const assets = publicAssets(io, source);
  io.mkdirSync(target, {recursive: true});
  // Refuse stale files instead of silently leaving them available for publication.
  const existing = io.readdirSync(target, {withFileTypes: true});
  if (existing.some(e => !files.includes(e.name) || !e.isFile())) {
    throw Error('Portfolio output contains unexpected files; use a clean portfolio-dist directory.');
  }
  for (const [name, bytes] of Object.entries(assets)) io.writeFileSync(path.join(target, name), bytes, {flag: existing.some(e => e.name === name) ? 'w' : 'wx'});
  return Object.keys(assets);
}
