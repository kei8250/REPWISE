// Run against a local dev server. Every API is intercepted; no real records are touched.
// REPWISE_PLAYWRIGHT_MODULE=/path/to/playwright node scripts/browser/exercise-picker.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)(
  process.env.REPWISE_PLAYWRIGHT_MODULE || 'playwright',
);
const origin = process.env.REPWISE_TEST_ORIGIN || 'http://localhost:3010';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
  args: ['--no-sandbox'],
});
const mode = process.env.REPWISE_TEST_CASE || 'all';
const failures = [];
try {
  for (const width of [320, 375, 390, 430]) {
    const context = await browser.newContext({
      viewport: { width, height: 568 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const masters = Array.from({ length: 65 }, (_, i) => ({
      id: `exercise-${i}`,
      name:
        i === 0
          ? 'バーベルルーマニアンデットリフト'
          : `種目${String(i).padStart(2, '0')}`,
      normalizedName: `exercise${i}`,
      bodyPart:
        i === 0
          ? '脚'
          : ['胸', '背中', '脚', '肩', '腕', '体幹', 'その他'][i % 7],
      measurementType: 'weight_reps',
      defaultRepMin: 8,
      defaultRepMax: 10,
      defaultWorkingSets: 1,
      defaultIncrementGrams: 2500,
      defaultRestSeconds: 90,
    }));
    const records = new Map();
    const writes = [];
    await context.route('**/api/**', async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname;
      if (path === '/api/v2/sync' && req.method() === 'POST') {
        const m = req.postDataJSON();
        writes.push(m);
        const w = {
          ...m.payload.workout,
          version: (records.get(m.entityId)?.version ?? 0) + 1,
        };
        records.set(w.id, w);
        return route.fulfill({
          json: { mutationId: m.mutationId, duplicate: false, workout: w },
        });
      }
      if (path === '/api/v2/exercises' && req.method() === 'POST') {
        const input = req.postDataJSON();
        const item = { ...masters[0], ...input, id: 'custom' };
        masters.push(item);
        return route.fulfill({ json: item });
      }
      assert.equal(req.method(), 'GET');
      if (path === '/api/v2/exercises') return route.fulfill({ json: masters });
      if (path.endsWith('/history'))
        return route.fulfill({
          json: { items: [], references: [], hasMore: false },
        });
      if (path.endsWith('/progression'))
        return route.fulfill({ status: 503, json: { error: 'fixture' } });
      if (path === '/api/v2/workouts') return route.fulfill({ json: [] });
      const found =
        records.get(path.split('/').at(-1)) ??
        masters.find((m) => m.id === path.split('/').at(-1));
      return route.fulfill({
        status: found ? 200 : 404,
        json: found ?? { error: 'fixture' },
      });
    });
    const start = async () => {
      await page.goto(`${origin}/workouts/new`);
      await page.waitForFunction(
        () => document.querySelector('#workout-date')?.value?.length === 10,
      );
      await page.getByLabel('トレーニング名（任意）').fill('保護する名前');
      await page
        .getByRole('button', { name: '種目を選ぶ', exact: true })
        .click();
    };
    try {
      await start();
      if (mode === 'scroll' && !(await page.getByRole('dialog').count()))
        await page
          .getByRole('button', { name: '種目を追加', exact: true })
          .first()
          .click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      if (mode !== 'scroll')
        assert.equal(
          writes.length,
          0,
          'Selecting exercises must not save an empty workout',
        );
      await dialog
        .getByRole('button', { name: /種目64/ })
        .waitFor({ state: 'attached' });
      // Find the actual vertical overflow container; verify its layout before any forced scroll.
      const metrics = await dialog.evaluate((d) => {
        const el = [...d.querySelectorAll('div')].find(
          (e) => getComputedStyle(e).overflowY === 'auto',
        );
        return { client: el.clientHeight, total: el.scrollHeight };
      });
      assert.ok(
        metrics.total > metrics.client + 100,
        `scroll container must be constrained: ${JSON.stringify(metrics)}`,
      );
      // Touch swipe starts on an exercise card, rather than a blank gutter.
      const card = dialog.getByRole('button', { name: /バーベルルーマニアン/ });
      const touch = await context.newCDPSession(page);
      const tabs = dialog
        .getByRole('button', { name: 'すべて', exact: true })
        .locator('..');
      const tabBounds = await tabs.boundingBox();
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [
          {
            x: tabBounds.x + tabBounds.width - 20,
            y: tabBounds.y + tabBounds.height / 2,
          },
        ],
      });
      for (let n = 1; n <= 8; n++)
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [
            {
              x: tabBounds.x + tabBounds.width - 20 - n * 20,
              y: tabBounds.y + tabBounds.height / 2,
            },
          ],
        });
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await page.waitForTimeout(200);
      assert.ok(
        await tabs.evaluate((e) => e.scrollLeft > 0),
        'body part tabs swipe horizontally',
      );
      assert.equal(
        await dialog.evaluate(
          (d) =>
            [...d.querySelectorAll('div')].find(
              (e) => getComputedStyle(e).overflowY === 'auto',
            ).scrollTop,
        ),
        0,
        'horizontal tabs must not scroll list vertically',
      );
      const cardBounds = await card.boundingBox();
      assert.ok(
        await card.evaluate((e) => e.scrollWidth <= e.clientWidth),
        'long names fit card',
      );
      const client = await context.newCDPSession(page);
      const x = cardBounds.x + 30,
        y = cardBounds.y + Math.min(cardBounds.height - 8, 40);
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x, y }],
      });
      for (let n = 1; n <= 8; n++)
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x, y: y - n * 12 }],
        });
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await page.waitForTimeout(300);
      assert.ok(
        await dialog.evaluate((d) =>
          [...d.querySelectorAll('div')].some(
            (e) => getComputedStyle(e).overflowY === 'auto' && e.scrollTop > 0,
          ),
        ),
        'swipe over card must scroll',
      );
      assert.equal(writes.length, 0, 'swipe must not select');
      // Wheel scroll to the end, then click the create form only once physically visible.
      await dialog.hover();
      for (let n = 0; n < 12; n++) await page.mouse.wheel(0, 900);
      const newName = dialog.getByLabel('種目名', { exact: true });
      await newName.scrollIntoViewIfNeeded();
      await newName.fill('スクロール検証種目');
      const create = dialog.getByRole('button', {
        name: '作成して追加',
        exact: true,
      });
      await create.scrollIntoViewIfNeeded();
      assert.ok(await create.isVisible());
      assert.ok(
        await create.evaluate((e) => {
          const r = e.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= innerHeight;
        }),
      );
      assert.ok(
        await newName.evaluate(
          (e) =>
            e.getBoundingClientRect().width <=
            e.closest('[role=dialog]').clientWidth,
        ),
      );
      // Cancel without selection: retain name/date, no workout writes. Repeat/open/filter.
      await dialog.locator('[data-slot="dialog-close"]').click();
      if (mode !== 'scroll') {
        assert.equal(writes.length, 0);
        assert.deepEqual(
          await page.evaluate(async () => {
            const db = await new Promise((resolve, reject) => {
              const r = indexedDB.open('repwise-local');
              r.onsuccess = () => resolve(r.result);
              r.onerror = () => reject(r.error);
            });
            const count = (name) =>
              new Promise((resolve, reject) => {
                const r = db.transaction(name).objectStore(name).count();
                r.onsuccess = () => resolve(r.result);
                r.onerror = () => reject(r.error);
              });
            const result = await Promise.all(
              ['workoutDrafts', 'workoutMutationQueue'].map(count),
            );
            db.close();
            return result;
          }),
          [0, 0],
          'cancel must not leave even a local empty record or queued create',
        );
        await page.mouse.wheel(0, 500);
        await page.waitForTimeout(150);
        assert.ok(
          await page.evaluate(() => window.scrollY > 0),
          'background scroll resumes after close',
        );
        assert.equal(
          await page.getByLabel('トレーニング名（任意）').inputValue(),
          '保護する名前',
        );
        await page
          .getByRole('button', { name: '種目を選ぶ', exact: true })
          .click();
      } else
        await page
          .getByRole('button', { name: '種目を追加', exact: true })
          .first()
          .click();
      await dialog.getByPlaceholder('種目名を検索').fill('存在しない種目');
      await dialog.getByText('該当する種目がありません').waitFor();
      await dialog.getByPlaceholder('種目名を検索').fill('');
      await dialog.getByRole('button', { name: '脚', exact: true }).click();
      await card.waitFor();
      assert.equal(
        await dialog.getByRole('button', { name: /種目01/ }).count(),
        0,
      );
      await dialog.getByRole('button', { name: 'すべて', exact: true }).click();
      // A reduced viewport models the space left by a keyboard (not a real OS keyboard).
      await page.setViewportSize({ width, height: 360 });
      await dialog.getByPlaceholder('種目名を検索').fill('種目64');
      const last = dialog.getByRole('button', { name: /種目64/ });
      await last.scrollIntoViewIfNeeded();
      await last.click();
      await page.waitForURL(/\/workouts\/active\//);
      await page.getByLabel('セット1の実績重量', { exact: true }).waitFor();
      await page.getByLabel('セット1の実績重量', { exact: true }).fill('60');
      await page.getByLabel('セット1の回数', { exact: true }).fill('8');
      await page.waitForFunction(
        () =>
          document.querySelector('header[data-local-save-state]')?.dataset
            .localSaveState === 'saved',
      );
      assert.ok(
        await page.evaluate(
          () => getComputedStyle(document.body).overflow !== 'hidden',
        ),
        'background unlocked',
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        'no horizontal overflow',
      );
      await page
        .getByLabel('トレーニング全体のメモ', { exact: true })
        .fill('保持するメモ');
      await page
        .getByRole('button', { name: '種目を追加', exact: true })
        .first()
        .click();
      await dialog.getByPlaceholder('種目名を検索').fill('');
      await page.evaluate(() => {
        Object.defineProperty(window.visualViewport, 'height', {
          configurable: true,
          value: 240,
        });
        Object.defineProperty(window.visualViewport, 'offsetTop', {
          configurable: true,
          value: 45,
        });
        window.visualViewport.dispatchEvent(new Event('resize'));
      });
      await page.waitForFunction(() => {
        const r = document
          .querySelector('[role=dialog]')
          .getBoundingClientRect();
        return r.top >= 45 && r.bottom <= 285;
      });
      const customName = dialog.getByLabel('種目名', { exact: true });
      await customName.scrollIntoViewIfNeeded();
      await customName.fill('スクロール検証種目');
      const createButton = dialog.getByRole('button', {
        name: '作成して追加',
        exact: true,
      });
      await createButton.scrollIntoViewIfNeeded();
      await createButton.click();
      await dialog.waitFor({ state: 'hidden' });
      await page
        .getByRole('button', { name: '1. 種目64', exact: true })
        .click();
      assert.equal(
        await page
          .getByLabel('トレーニング全体のメモ', { exact: true })
          .inputValue(),
        '保持するメモ',
      );
      assert.equal(
        await page
          .getByLabel('セット1の実績重量', { exact: true })
          .first()
          .inputValue(),
        '60',
      );
      assert.equal(
        await page
          .getByLabel('セット1の回数', { exact: true })
          .first()
          .inputValue(),
        '8',
      );
      await page
        .getByRole('button', { name: '2. スクロール検証種目', exact: true })
        .first()
        .waitFor();
      assert.deepEqual(errors, []);
      console.log(
        `PASS ${width}px: constrained scroll, touch swipe, full names, create reached, cancel, search/filter/reopen, 360px height, select and input`,
      );
    } catch (error) {
      failures.push(`${width}px: ${error.message}`);
      console.error(failures.at(-1));
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
assert.deepEqual(failures, []);
