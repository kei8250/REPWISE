// Run only against the validated v17 build before rebuilding. Retain its full
// static dependency graph byte-for-byte so already-open pages keep working.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const source = path.resolve('dist/client/_next/static');
const target = path.resolve('retained-assets/v17/_next/static');
const files = [];
function copy(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const from = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      copy(from);
      continue;
    }
    if (!entry.isFile()) throw new Error('Static assets must be regular files');
    const relative = path.relative(source, from);
    const bytes = fs.readFileSync(from);
    const to = path.join(target, relative);
    if (fs.existsSync(to) && !fs.readFileSync(to).equals(bytes))
      throw new Error(`Asset collision: ${relative}`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    files.push({
      path: '/_next/static/' + relative.replaceAll('\\', '/'),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
}
if (!fs.existsSync(path.join(source, 'chunks/index-DP0GV7Xz.js')))
  throw new Error('Not the reviewed v17 build');
copy(source);
fs.writeFileSync(
  'docs/retained-assets-v17.json',
  JSON.stringify(
    {
      version: 17,
      policy:
        'Retain byte-for-byte; no automatic pruning. Review open-client compatibility before any future removal.',
      files,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Retained ${files.length} v17 assets.`);
