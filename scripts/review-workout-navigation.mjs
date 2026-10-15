// Invoked by the existing isolated API fixture harness with --navigation.
export async function reviewWorkoutNavigation({
  send,
  evalJs,
  go,
  until,
  tap,
  clickText,
  pause,
  shot,
  setViewport,
  overflow,
  check,
  server,
  fixtureWorkout,
  setOnline,
  fixturesDir,
}) {
  server.set('single-history', {
    ...fixtureWorkout,
    id: 'single-history',
    name: '直接開くテスト記録',
    localDate: '2026-10-11',
    startedAt: '2026-10-11T08:00:00Z',
  });
  setOnline(true);
  await send('Page.bringToFront');
  await setViewport(375);
  await go(
    '/workouts/active/draft-old',
    "document.body.innerText.includes('削除対象の古い入力途中')",
  );
  check(
    await evalJs(
      `Boolean(document.querySelector('nav[aria-label="モバイルナビゲーション"] a[href="/analytics"]'))`,
    ),
    'recording_keeps_analysis_navigation',
  );
  await go(
    '/history?status=active&month=all',
    `document.querySelector('a[href="/workouts/active/draft-old"]')`,
  );
  setOnline(false);
  await evalJs(
    `document.querySelector('button[aria-label="削除対象の古い入力途中の削除操作を表示"]').click()`,
  );
  await tap('button[aria-label="削除対象の古い入力途中を削除"]');
  await until(
    `!document.querySelector('a[href="/workouts/active/draft-old"]')`,
  );
  await go(
    '/settings',
    "document.body.innerText.includes('削除の反映待ち（1件）')",
  );
  await evalJs(
    `Array.from(document.querySelectorAll('summary')).find(e=>e.textContent.includes('削除の反映待ち')).click()`,
  );
  await until("document.body.innerText.includes('削除の反映を再試行')");
  check(
    await evalJs(
      `!document.querySelector('a[href="/workouts/active/draft-old"]') && !document.body.innerText.includes('同期失敗・記録は端末に保存済み')`,
    ),
    'deleted_failure_has_no_dead_workout_link',
  );
  check(await overflow(), 'deleted_sync_no_overflow_375');
  await shot(`${fixturesDir}/deleted-sync-375.png`);
  await setViewport(390);
  await shot(`${fixturesDir}/deleted-sync-390.png`);

  await go(
    '/workouts/active/draft-old',
    "document.body.innerText.includes('削除済みです')",
  );
  await setViewport(375);
  check(await overflow(), 'deleted_route_no_overflow_375');
  await shot(`${fixturesDir}/deleted-route-375.png`);
  await tap('nav[aria-label="モバイルナビゲーション"] a[href="/workouts/new"]');
  await until(
    "location.pathname==='/workouts/new' && document.body.innerText.includes('ワークアウトを開始')",
  );
  check(true, 'deleted_route_can_start_recording_without_reopening_site');
  await setViewport(390);
  await go(
    '/workouts/active/missing-record',
    "document.body.innerText.includes('まだ同期されていません')",
  );
  await shot(`${fixturesDir}/missing-route-390.png`);
  await tap('nav[aria-label="モバイルナビゲーション"] a[href="/analytics"]');
  await until(
    "location.pathname==='/analytics' && document.body.innerText.includes('詳細分析')",
  );
  check(true, 'missing_route_can_open_analysis_without_reopening_site');
  await go(
    '/workouts/missing-record',
    "document.body.innerText.includes('履歴へ戻る')",
  );
  await tap('nav[aria-label="モバイルナビゲーション"] a[href="/history"]');
  await until("location.pathname==='/history'");
  check(true, 'missing_detail_keeps_history_navigation');

  setOnline(true);
  await go(
    '/settings',
    "document.body.innerText.includes('削除の反映待ち（1件）')",
  );
  await evalJs(
    `Array.from(document.querySelectorAll('summary')).find(e=>e.textContent.includes('削除の反映待ち')).click()`,
  );
  await clickText('削除の反映を再試行');
  await until("document.body.innerText.includes('削除の反映待ち：0件')");
  check(
    Boolean(server.get('draft-old').deletedAt),
    'retry_applies_delete_and_removes_pending_entry',
  );

  for (const width of [375, 390]) {
    await setViewport(width);
    await go(
      '/',
      `document.querySelector('button[aria-label^="2026年10月11日"]:not(:disabled)')`,
    );
    // Day cells fit a seven-column mobile calendar; use native touch at its centre.
    async function touchDay(day) {
      const selector = `button[aria-label^="2026年10月${day}日"]`;
      await evalJs(
        `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`,
      );
      await pause(150);
      const point = await evalJs(
        `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
      );
      await send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [point],
      });
      await send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
    }
    await shot(`${fixturesDir}/calendar-${width}.png`);
    await touchDay(11);
    await until(
      "location.pathname==='/workouts/single-history' && document.body.innerText.includes('直接開くテスト記録')",
    );
    check(true, `single_date_opens_workout_directly_${width}`);
    check(await overflow(), `single_detail_no_overflow_${width}`);
    await go(
      '/',
      `document.querySelector('button[aria-label^="2026年10月10日"]:not(:disabled)')`,
    );
    await touchDay(10);
    await until(
      `document.querySelector('[role="dialog"] a[href="/workouts/valid-history"]')`,
    );
    check(
      await evalJs(
        `location.pathname==='/' && document.querySelectorAll('[role="dialog"] li a').length===2`,
      ),
      `multiple_workouts_choose_in_place_${width}`,
    );
    check(await overflow(), `calendar_chooser_no_overflow_${width}`);
    await shot(`${fixturesDir}/calendar-chooser-${width}.png`);
    // Escape closes and restores focus to the day without changing the route.
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    await until(`!document.querySelector('[role="dialog"]')`);
    check(
      await evalJs(
        `document.activeElement?.getAttribute('aria-label')?.startsWith('2026年10月10日')`,
      ),
      `calendar_chooser_restores_day_focus_${width}`,
    );
    await touchDay(10);
    await until(
      `document.querySelector('[role="dialog"] a[href="/workouts/valid-history"]')`,
    );
    await tap('[role="dialog"] a[href="/workouts/valid-history"]');
    await until(
      "location.pathname==='/workouts/valid-history' && document.body.innerText.includes('10月10日ベンチ履歴')",
    );
    check(true, `multiple_date_opens_selected_workout_${width}`);
  }
}
