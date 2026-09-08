// Build-only old-client protection. No routing or cache policy changes.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const sourceRoot = path.resolve('retained-assets/v17');
const outputRoot = path.resolve('dist/client');
const manifest = JSON.parse(
  fs.readFileSync('docs/retained-assets-v17.json', 'utf8'),
);
if (!fs.existsSync('dist/server/index.js'))
  throw new Error('Build the current Worker before merging retained assets');

for (const asset of manifest.files) {
  if (!/^\/_next\/static\/[a-zA-Z0-9_./-]+$/.test(asset.path))
    throw new Error('Invalid retained asset URL');
  const source = path.resolve(sourceRoot, '.' + asset.path);
  const destination = path.resolve(outputRoot, '.' + asset.path);
  if (
    !source.startsWith(sourceRoot + path.sep) ||
    !destination.startsWith(outputRoot + path.sep)
  )
    throw new Error('Retained asset must stay inside its asset tree');
  const bytes = fs.readFileSync(source);
  if (
    bytes.length !== asset.bytes ||
    createHash('sha256').update(bytes).digest('hex') !== asset.sha256
  )
    throw new Error(`Retained asset changed: ${asset.path}`);
  if (fs.existsSync(destination)) {
    if (!fs.readFileSync(destination).equals(bytes))
      throw new Error(`Current/retained asset collision: ${asset.path}`);
  } else {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
}
console.log(`Validated and retained ${manifest.files.length} v17 assets.`);
