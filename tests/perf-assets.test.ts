import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

describe('Perf A1 font and old-client delivery safety', () => {
  it('retains all Japanese font subsets with relative URLs and valid WOFF2', () => {
    const directory = 'app/fonts/noto-sans-jp';
    const css = fs.readFileSync(path.join(directory, 'font.css'), 'utf8');
    expect(css.match(/@font-face/g)).toHaveLength(125);
    expect(css.match(/unicode-range:/g)).toHaveLength(124);
    expect(css).not.toMatch(/[A-Za-z]:[/\\]|\.vinext|fonts\.gstatic/);
    const files = [...css.matchAll(/url\('\.\/([^']+)'\)/g)];
    expect(files).toHaveLength(124);
    for (const [, file] of files)
      expect(
        fs.readFileSync(path.join(directory, file)).subarray(0, 4).toString(),
      ).toBe('wOF2');
    expect(fs.readFileSync('app/layout.tsx', 'utf8')).not.toContain(
      'next/font/google',
    );
  });
  it('retains every v17 asset byte-for-byte, including dynamic dependencies', () => {
    const manifest = JSON.parse(
      fs.readFileSync('docs/retained-assets-v17.json', 'utf8'),
    ) as { files: { path: string; sha256: string }[] };
    expect(manifest.files.length).toBeGreaterThan(20);
    for (const file of manifest.files) {
      const bytes = fs.readFileSync('retained-assets/v17' + file.path);
      expect(createHash('sha256').update(bytes).digest('hex'), file.path).toBe(
        file.sha256,
      );
    }
  });
});
