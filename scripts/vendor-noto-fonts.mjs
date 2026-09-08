// One-time, reproducible extraction from the existing Vinext Google Fonts cache.
// No subset is dropped. Commit the resulting CSS/fonts so future builds need
// neither the old checkout path nor a Google Fonts network request.
import fs from 'node:fs';
import path from 'node:path';
import {
  buildFallbackFontFace,
  getFallbackFontOverrideMetrics,
} from '../node_modules/vinext/dist/build/google-fonts/fallback-metrics.js';

const source = path.resolve('.vinext/fonts/noto-sans-jp-d22312ada54c');
const target = path.resolve('app/fonts/noto-sans-jp');
fs.mkdirSync(target, { recursive: true });
let count = 0;
const css = fs
  .readFileSync(path.join(source, 'style.css'), 'utf8')
  .replace(/url\(([^)]+)\)/g, (_match, oldPath) => {
    const filename = path.posix.basename(oldPath.replaceAll('\\', '/'));
    if (!/^noto-sans-jp-[a-f0-9]{8}\.woff2$/.test(filename)) {
      throw new Error(`Unexpected font asset: ${filename}`);
    }
    const bytes = fs.readFileSync(path.join(source, filename));
    if (bytes.subarray(0, 4).toString() !== 'wOF2')
      throw new Error('Invalid WOFF2');
    fs.copyFileSync(path.join(source, filename), path.join(target, filename));
    count++;
    return `url('./${filename}')`;
  });
if (count !== 124) throw new Error(`Expected all 124 subsets, got ${count}`);
const fallback = buildFallbackFontFace(
  'Noto Sans JP',
  getFallbackFontOverrideMetrics('Noto Sans JP'),
);
fs.writeFileSync(
  path.join(target, 'font.css'),
  `/* Noto Sans JP: all original Unicode ranges retained; SIL OFL 1.1. */\n${css}\n${fallback}\n:root { --font-noto-sans-jp: 'Noto Sans JP', 'Noto Sans JP Fallback', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', Meiryo, sans-serif; }\n`,
);
console.log(
  `Vendored ${count} WOFF2 files, ${count + 1} font-face definitions.`,
);
