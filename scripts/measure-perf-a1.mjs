// Read-only verification-origin probe. Never writes workout data or credentials.
// REPWISE_PERF_AUTH is supplied only in the invoking process environment.
import https from 'node:https';
import zlib from 'node:zlib';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const origin = 'https://repwise-phase1a-review.keikei8250.chatgpt.site';
const agent = new https.Agent({ keepAlive: true, maxSockets: 4 });
const output = process.argv[2];
if (!output || !process.env.REPWISE_PERF_AUTH)
  throw new Error('Output path and ephemeral verification auth are required');
async function get(path, headers = {}) {
  if (!path.startsWith('/') || path.startsWith('//'))
    throw new Error('Same-origin paths only');
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const request = https.get(
      origin + path,
      {
        agent,
        headers: {
          'OAI-Sites-Authorization': process.env.REPWISE_PERF_AUTH,
          'Accept-Encoding': 'gzip',
          ...headers,
        },
      },
      (response) => {
        const ttfb = performance.now() - started;
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const wire = Buffer.concat(chunks);
          const body =
            response.headers['content-encoding'] === 'gzip'
              ? zlib.gunzipSync(wire)
              : wire;
          resolve({
            path,
            status: response.statusCode,
            ttfbMs: Math.round(ttfb),
            totalMs: Math.round(performance.now() - started),
            wireBytes: wire.length,
            bytes: body.length,
            cache: response.headers['cache-control'] ?? null,
            etag: response.headers.etag ?? null,
            contentType: response.headers['content-type'],
            ray: response.headers['cf-ray'],
            sha256: createHash('sha256').update(body).digest('hex'),
            body,
          });
        });
      },
    );
    request.setTimeout(20000, () =>
      request.destroy(new Error('request timeout')),
    );
    request.on('error', reject);
  });
}
const clean = ({ body: _body, ...record }) => record;
const results = {
  timestamp: new Date().toISOString(),
  method: 'HTTPS probe; not browser HAR; dedicated authentication path',
  pages: [],
  assets: [],
  conditional: [],
  retained: [],
};
try {
  for (const path of [
    '/',
    '/workouts/new',
    '/history',
    '/workouts/d4875ebb-93f4-4eb6-9601-68e26ad76430',
  ]) {
    for (let i = 0; i < 3; i++) {
      const response = await get(path);
      if (response.status !== 200)
        throw new Error(`Unexpected status ${response.status}: ${path}`);
      const html = response.body.toString();
      const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(
        (m) => m[1],
      );
      const assetUrls = [
        ...new Set(
          [...html.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))"/g)]
            .map((m) => m[1])
            .filter((url) => url.startsWith('/_next/')),
        ),
      ];
      results.pages.push({
        ...clean(response),
        inlineStyleBytes: styles.reduce(
          (sum, s) => sum + Buffer.byteLength(s),
          0,
        ),
        inlineFontFaces: styles.reduce(
          (sum, s) => sum + (s.match(/@font-face/g) ?? []).length,
          0,
        ),
        localPathUrls: (html.match(/url\(["']?[A-Za-z]:[/\\]/g) ?? []).length,
        assetUrls,
      });
    }
  }
  const urls = results.pages[0].assetUrls;
  for (const url of urls.filter((url) =>
    /(?:\/index-|\/framework-|\.css$)/.test(url),
  )) {
    const response = await get(url);
    const text = response.body.toString();
    results.assets.push({
      ...clean(response),
      fontFaces: (text.match(/@font-face/g) ?? []).length,
      localPathUrls: (text.match(/url\(["']?[A-Za-z]:[/\\]/g) ?? []).length,
      fontUrls: [
        ...new Set(
          [...text.matchAll(/url\(["']?([^)'"\s]+\.woff2)["']?\)/g)].map(
            (m) => m[1],
          ),
        ),
      ],
    });
    if (response.etag)
      results.conditional.push(
        clean(await get(url, { 'If-None-Match': response.etag })),
      );
  }
  if (process.argv.includes('--retained')) {
    const manifest = JSON.parse(
      fs.readFileSync('docs/retained-assets-v17.json', 'utf8'),
    );
    const files = manifest.files.filter((file) =>
      /\.(js|css)$/.test(file.path),
    );
    for (let i = 0; i < files.length; i += 4)
      await Promise.all(
        files.slice(i, i + 4).map(async (file) => {
          const response = await get(file.path);
          results.retained.push({
            ...clean(response),
            matchesV17:
              response.status === 200 && response.sha256 === file.sha256,
          });
        }),
      );
  }
  fs.mkdirSync('outputs', { recursive: true });
  fs.writeFileSync(output, JSON.stringify(results, null, 2) + '\n');
  console.log(
    JSON.stringify({
      output,
      pages: results.pages.map(
        ({
          path,
          ttfbMs,
          bytes,
          inlineStyleBytes,
          inlineFontFaces,
          localPathUrls,
        }) => ({
          path,
          ttfbMs,
          bytes,
          inlineStyleBytes,
          inlineFontFaces,
          localPathUrls,
        }),
      ),
      assets: results.assets.map(
        ({ path, bytes, cache, fontFaces, localPathUrls, fontUrls }) => ({
          path,
          bytes,
          cache,
          fontFaces,
          localPathUrls,
          fontUrlCount: fontUrls.length,
        }),
      ),
      retained: results.retained.length,
      retainedFailures: results.retained.filter((x) => !x.matchesV17).length,
    }),
  );
} finally {
  agent.destroy();
}
